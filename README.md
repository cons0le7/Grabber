# Grabber  

**⚠️ Educational / Demonstration Purposes Only**  
This project is a **social engineering proof-of-concept (POC)**. It is **NOT** intended for malicious use. The author takes **no responsibility** for any misuse of this tool.  

---

## 📖 Overview  
Grabber simulates a fake **Local Listings Finder** website. Its purpose is to demonstrate **how easily location and camera permissions can be exploited** if users trust an unknown site.  

### ✅ What happens when a user visits the page?
- The site appears as a legitimate local listings scanner.
- Collects:
  - **Server-facing IP**
  - **Public IP** (via IPify API)
  - **WebRTC leak IPs**
- If **location permission** is granted:
  - A map appears showing their location.
- If **camera permission** is granted:
  - Captures **3 front-facing photos silently**.
  - Shows a **fake error popup**:  
    *"Failed to initialize camera."*
- All logs saved in `data.json`.
- Captured photos saved in `/images`.

An **admin dashboard** allows:
✔ Viewing IP details (with WHOIS info)  
✔ Viewing captured geolocation on an interactive map  
✔ Viewing captured images (single photo or image carousel with navigation & autoplay)  

---

## ✨ Features  
- ✅ **Disguised UI** – Fake local listings scanner page.  
- ✅ **IP Collection** – Server IP, Public IP, WebRTC IP leaks.  
- ✅ **Location Tracking** – Displays OpenStreetMap embed if allowed.  
- ✅ **Silent Camera Capture** – Three selfies captured in background, fake error displayed.  
- ✅ **Secure Admin Panel** – Login protected with **scrypt-hashed credentials**.  
- ✅ **Image Carousel** – Displays multiple images with counter and autoplay.  
- ✅ **Serveo Integration** – Expose your local server securely.  
- ✅ **Optional URL Shortening** – Offers 3 shortening services automatically.  

---

## ⚡ Installation  
Install required packages:  
```bash
apk add git nodejs npm python3 py3-pip openssh
git clone https://github.com/cons0le7/Grabber
cd Grabber
