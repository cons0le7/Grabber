# Grabber

##Install: 
```
apk add git nodejs npm python3 py3-pip openssh
git clone https://github.com/cons0le7/Grabber

```
##How to use:  
- cd to clone directory and run grab.py: 
```
cd Grabber
python3 grab.py
```
This will: 
- Start the server on `http://localhost:3000`
- Create a tunnel to expose your server to the web with serveo.
- Output a link where the server can be accessed.
Copy link and send to user. When user clicks link it will request location and display their coordinates on a map. If they click the scan button the
