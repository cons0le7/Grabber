# Grabber  

**⚠️ Educational / Demonstration Purposes Only ⚠️**  
This project is a **social engineering proof-of-concept (POC)**. It is **NOT** intended for malicious use. The author takes **no responsibility** for any misuse of this tool.  

---

## 📖 Overview  
Grabber simulates a fake **Nearby Price Finder** website. Its purpose is to demonstrate **how easily location and camera permissions can be exploited** if users trust an unknown site.  

### ✅ What happens when a user visits the page?
- The site appears as a legitimate **tool for finding the best nearby prices of items scanned from your phone’s camera**.
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
- ✅ **Disguised UI** – Fake nearby price finder scanner page.  
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
~~~bash
apk add git nodejs npm python3 py3-pip openssh
git clone https://github.com/cons0le7/Grabber
cd Grabber
~~~

---

## 🔐 Set Admin Credentials  
Run:  
~~~bash
python3 pass.py
~~~
✔ Prompts for username & password  
✔ Hashes and salts credentials using **scrypt**  
✔ Saves securely in `config.json`  

**Tip:** Delete `pass.py` after setup for extra security.  

---

# 🛠 Usage Flow  

## ▶️ Run the Server  
Start Grabber using the automated script:  
~~~bash
python3 grab.py
~~~

This will:  
- Kill any process on port `3000`.  
- Ask if you want to shorten the URL (3 options available).  
- Start the Node.js server on `http://localhost:3000`.  
- Create a **Serveo tunnel** and display a public link.  

---
Send generated link to test device.
___

### On Test Device:
- Open the Serveo link.  
- Accept **location permissions** → Displays map.  
- Tap **“Scan Item”** → Accept **camera permissions**.  
- **Fake error** appears: *"Failed to initialize camera."* (images are still captured).  

### On Server:
- Access the admin panel: `http://localhost:3000/admin` or `http://127.0.0.1:3000/admin`
- Log in using your credentials.  
- View:
✔ Collected IP info with WHOIS  
✔ Click coordinates → Opens interactive map  
✔ Captured images → Displayed in a carousel (with arrows buttons to cycle & autoplay button).  

---

## 📂 Data Storage  
- **Captured images:** `/images`  
- **All session data:** `data.json`  

---

## ⚠️ Disclaimer ⚠️
This tool is **strictly for educational purposes**.  
Do **NOT** use it against individuals or systems without **explicit consent**.  
The author assumes **no liability** for any misuse, legal consequences, or damage.  
