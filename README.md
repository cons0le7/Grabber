# Grabber
This is a social engineering POC for demonstration purposes only. Do not use this tool against anyone. I am not responsible for any use or misuse of this tool. 
## Explaination: 
This is a page made to appear as a website for finding local listings of items scanned from your phones camera. When site is accessed, server facing and external ips (using ipify API ) are logged and an attempt to log ips using WebRTC is performed. A map appears and requests location permissions from user. If granted, their coordinates will appear on the map and are logged to backend. There is a "scan item" button on the site which requests camera permissions. If granted, it takes a photo from front-facing camera in the background and a popup appears showing "Failed to initialize camera", in reality the snapped image is saved to `/images`. All logged data is stored in `data.json`. 
Data can be accessed via web by accessing servio link with `/admin`. logged public ips will display whois information. Saved photos will also be seen here. 

## Install: 
```
apk add git nodejs npm python3 py3-pip openssh 
git clone https://github.com/cons0le7/Grabber
```
## How to use:  
- Set admin login credentials
```
cd Grabber
python3 pass.py
```
credentials are salted and hashed with scrypt and stored in `config.json` 

For additional security you can remove `pass.py` from server directory or delete it and restore it if needed to change authentication later. 

- cd to clone directory and run grab.py: 
```
python3 grab.py
```
This will: 
- Kill any existing processes on port 3000.
- Ask if you want to use a URL shortener and provide 3 options if you choose so. 
- Start the server on `http://localhost:3000`
- Create a tunnel to expose your server to the web with serveo.
- Output a link where the server can be accessed.


Copy the link and send to test device.

- Ctrl+C twice to shutdown.

From test device: 
- Accept location permissions
- Tap "scan item" button
- Accept camera permissions

From server: 
- Access `http://localhost:3000/admin` or `http://127.0.0.1:3000/admin`
- Log in using credentials.
- View saved data
- Clicking coordinates opens an interactive map with pin of grabbed location.
- If images are captured they will appear on a carousel displayed within the record they were captured from. There are arrow buttons to cycle through them and there is play button to have them auto cycle. 

