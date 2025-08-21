import subprocess
import time

server = subprocess.Popen(
    ["node", "server.js"],  # no stdout/stderr redirection
)
time.sleep(2)
print("""















""")
tunnel = subprocess.Popen(
    ["ssh", "-o", "StrictHostKeyChecking=no", "-R", "80:localhost:3000", "serveo.net"]
)
time.sleep(3.5)
print("""















""")
try:
    tunnel.wait()
except KeyboardInterrupt:
    print("Shutting down...")
finally:
    server.terminate()
    tunnel.terminate()

