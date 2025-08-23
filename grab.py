import subprocess
import threading
import re
import requests
import sys
import signal
import os
from queue import Queue, Empty
import time
import shutil
import socket
import pwd

PORT = 3000
serveo_url = None
shutdown_flag = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
CURRENT_USER = pwd.getpwuid(os.getuid()).pw_name

# --- Function to check if port is in use ---
def check_port(port):
    try:
        result = subprocess.run(
            ["lsof", "-i", f":{port}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        lines = result.stdout.strip().split("\n")[1:]  # skip header
        processes = []
        for line in lines:
            parts = re.split(r'\s+', line)
            if len(parts) >= 2:
                pid = int(parts[1])
                user = parts[2]
                cmd = parts[0]
                processes.append((pid, user, cmd))
        return processes
    except Exception:
        return []

# --- Prompt user to kill processes if port is in use ---
while True:
    procs = check_port(PORT)
    if not procs:
        break

    print(f"Port {PORT} is in use by the following processes:")
    for pid, user, cmd in procs:
        print(f"PID {pid} | User: {user} | Command: {cmd}")

    choice = input("Do you want to kill these processes? (y/n): ").strip().lower()
    if choice == 'y':
        for pid, user, cmd in procs:
            # only kill if owned by current user
            if user == CURRENT_USER:
                try:
                    os.kill(pid, signal.SIGTERM)
                    time.sleep(0.5)
                    os.kill(pid, signal.SIGKILL)
                    print(f"Killed PID {pid} ({cmd})")
                except Exception as e:
                    print(f"Failed to kill PID {pid}: {e}")
            else:
                print(f"Skipping PID {pid} ({cmd}) - not owned by you")
        time.sleep(1)
    else:
        print("Cannot continue while port is in use. Exiting.")
        sys.exit(1)

# --- Prompt user to select a folder from /public ---
folders = [f for f in os.listdir(PUBLIC_DIR) if os.path.isdir(os.path.join(PUBLIC_DIR, f))]
if not folders:
    print("No folders found in /public. Exiting.")
    sys.exit(1)

print("\nSelect a folder to load its user.html:")
for i, folder in enumerate(folders, start=1):
    print(f"{i} - {folder}")

while True:
    choice = input("Enter number: ").strip()
    if choice.isdigit() and 1 <= int(choice) <= len(folders):
        selected_folder = folders[int(choice) - 1]
        source_file = os.path.join(PUBLIC_DIR, selected_folder, "user.html")
        dest_file = os.path.join(PUBLIC_DIR, "user.html")
        if os.path.exists(source_file):
            shutil.copy2(source_file, dest_file)
            print(f"Loaded {selected_folder}/user.html into /public/user.html")
        else:
            print(f"No user.html found in {selected_folder}, continuing with default")
        break
    else:
        print("Invalid choice, try again.")

# --- Ask user if they want to shorten URL ---
shorten_choice = input("Shorten URL? (y/n): ").strip().lower()
shorten_url = shorten_choice == 'y'

shortener_choice = None
if shorten_url:
    print("\nChoose a URL shortener:")
    print("1 - is.gd")
    print("2 - da.gd")
    print("3 - v.gd")
    shortener_choice = input("Enter 1, 2, or 3: ").strip()
    if shortener_choice not in ['1', '2', '3']:
        shortener_choice = '1'

# --- Helper to read lines from a process ---
def enqueue_output(process, queue):
    for line in iter(process.stdout.readline, ''):
        queue.put(line)
    process.stdout.close()

# --- URL shortening function ---
def shorten(long_url):
    try:
        if shortener_choice == '1':
            response = requests.get("https://is.gd/create.php", params={"format": "simple", "url": long_url}, timeout=5)
        elif shortener_choice == '2':
            response = requests.get(f"https://da.gd/s?url={long_url}", timeout=5)
        elif shortener_choice == '3':
            response = requests.get("https://v.gd/create.php", params={"format": "simple", "url": long_url}, timeout=5)
        else:
            return None
        if response.status_code == 200:
            return response.text.strip()
    except requests.RequestException as e:
        print(f"Error shortening URL: {e}")
    return None

# --- Graceful shutdown ---
def shutdown(sig=None, frame=None):
    global shutdown_flag
    if shutdown_flag:
        return
    shutdown_flag = True
    print("\nShutting down...")

    for proc, name in [(server, "Node server"), (ssh_process, "SSH tunnel")]:
        try:
            proc.terminate()
            proc.wait(timeout=5)
            print(f"{name} terminated.")
        except Exception:
            try:
                proc.kill()
                print(f"{name} killed.")
            except Exception:
                print(f"Failed to terminate {name}.")

    print("Shutdown complete.")
    sys.exit(0)

signal.signal(signal.SIGINT, shutdown)
signal.signal(signal.SIGTERM, shutdown)

# --- Start Node server ---
server = subprocess.Popen(
    ["node", "server.js"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1
)

# --- Start SSH tunnel to Serveo ---
ssh_process = subprocess.Popen(
    ["ssh", "-o", "StrictHostKeyChecking=no", "-R", f"80:localhost:{PORT}", "serveo.net"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1
)

node_queue = Queue()
ssh_queue = Queue()

threading.Thread(target=enqueue_output, args=(server, node_queue), daemon=True).start()
threading.Thread(target=enqueue_output, args=(ssh_process, ssh_queue), daemon=True).start()

# --- Main loop ---
start_time = time.time()
timeout = 30

try:
    while not shutdown_flag:
        # Node output
        try:
            line = node_queue.get(timeout=0.1)
            print(line, end='')
        except Empty:
            pass

        # SSH output
        try:
            line = ssh_queue.get(timeout=0.1)
            print(line, end='')

            if serveo_url is None:
                match = re.search(r'https?://[^\s]*\.serveo\.net', line)
                if match:
                    serveo_url = match.group(0)
                    print(f"\nServeo URL: {serveo_url}")

                    if shorten_url:
                        short_url = shorten(serveo_url)
                        if short_url:
                            print(f"\nShortened URL: {short_url}\n")
        except Empty:
            pass

        # Timeout for Serveo URL detection
        if serveo_url is None and (time.time() - start_time) > timeout:
            print("\nCould not find Serveo URL within timeout.")
            serveo_url = "timeout"

        # Exit if both processes finished
        if server.poll() is not None and ssh_process.poll() is not None:
            break

except Exception as e:
    print(f"\nError: {e}")
finally:
    shutdown()
