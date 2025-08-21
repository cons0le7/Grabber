import subprocess
import time

# Start Node.js server
server = subprocess.Popen(
    ["node", "server.js"],  # no stdout/stderr redirection
)

# Wait a moment for server to start
time.sleep(2)

# Start Serveo tunnel
tunnel = subprocess.Popen(
    ["ssh", "-o", "StrictHostKeyChecking=no", "-R", "80:localhost:3000", "serveo.net"]
)

try:
    tunnel.wait()
except KeyboardInterrupt:
    print("Shutting down...")
finally:
    server.terminate()
    tunnel.terminate()

