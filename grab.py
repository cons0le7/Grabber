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

# --- Colors ---
RESET = "\033[0m"
BLACK = "\033[90m"
RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
MAGENTA = "\033[95m"
CYAN = "\033[96m"
WHITE = "\033[97m"

PORT = 3000
serveo_url = None
ssh_url_to_print = None
shutdown_flag = False
ssh_process = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
CURRENT_USER = pwd.getpwuid(os.getuid()).pw_name

# ASCII ART
print(rf"""{RED}
_________                            .__                  
\_   ___ \  ____   ____   __________ |  |   ____   ______ 
/    \  \/ /  _ \ /    \ /  ___/  _ \|  | _/ __ \ /  ___/ 
\     \___(  <_> )   |  \\___ (  <_> )  |_\  ___/ \___ \  
 \______  /\____/|___|  /____  >____/|____/\___  >____  > 
        \/            \/     \/                \/     \/  
  ________            ___.       __                .__    
 /  _____/___________ \_ |__   _/  |_  ____   ____ |  |   
/   \  __\_  __ \__  \ | __ \  \   __\/  _ \ /  _ \|  |   
\    \_\  \  | \// __ \| \_\ \  |  | (  <_> |  <_> )  |__ 
 \______  /__|  (____  /___  /  |__|  \____/ \____/|____/ 
        \/           \/    \/                             
{RESET}""")

# --- Select mode ---
print(f"\n{CYAN}Select mode:{RESET}\n")
print(f"{YELLOW}[1]{CYAN} - {GREEN}Local mode{RESET}")
print(f"{YELLOW}[2]{CYAN} - {GREEN}Public mode{RESET}")

while True:
    mode_choice = input(f"\n{GREEN}>>> {RESET}").strip()
    if mode_choice in ['1','2']:
        break
    else:
        print("\nInvalid choice, try again.")

local_mode = (mode_choice == '1')

# --- Check if port is in use ---
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
            if len(parts) >= 3:
                cmd = parts[0]
                pid = int(parts[1])
                user = parts[2]
                processes.append((pid, user, cmd))
        return processes
    except Exception:
        return []

# --- Kill processes if needed ---
while True:
    procs = check_port(PORT)
    if not procs:
        break

    print(f"\n{GREEN}Port {PORT} is in use by the following processes:{RESET}\n")
    for pid, user, cmd in procs:
        print(f"{YELLOW}PID {pid}{RESET} | User: {GREEN}{user}{RESET} | Command: {GREEN}{cmd}{RESET}")

    choice = input(f"\n{GREEN}>>> Kill these processes? (y/n): {RESET}").strip().lower()
    if choice == 'y':
        for pid, user, cmd in procs:
            if user == CURRENT_USER:
                try:
                    os.kill(pid, signal.SIGTERM)
                    time.sleep(0.5)
                    try: os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                    print(f"\n{GREEN}Killed PID {pid} ({cmd}){RESET}")
                except Exception as e:
                    print(f"\nFailed to kill PID {pid}: {e}")
            else:
                print(f"\nSkipping PID {pid} ({cmd}) - not owned by you")
        time.sleep(1)
    else:
        print("\nCannot continue while port is in use. Exiting.")
        sys.exit(1)

# --- Theme selection with skip ---
folders = [f for f in os.listdir(PUBLIC_DIR) if os.path.isdir(os.path.join(PUBLIC_DIR, f))]
if not folders:
    print("\nNo folders found in /public. Exiting.")
    sys.exit(1)

print(f"\n{CYAN}Select user-facing theme:{RESET}\n")
for i, folder in enumerate(folders, start=1):
    print(f"{YELLOW}[{i}]{CYAN} - {GREEN}{folder}{RESET}")
print(f"{CYAN}\nPress Enter to skip and keep current user.html{RESET}")

while True:
    choice = input(f"\n{GREEN}>>> {RESET}").strip().lower()
    if choice == '':
        print(f"\n{YELLOW}Skipping theme selection. Keeping current user.html{RESET}")
        break
    elif choice.isdigit() and 1 <= int(choice) <= len(folders):
        selected_folder = folders[int(choice)-1]
        source_file = os.path.join(PUBLIC_DIR, selected_folder, "user.html")
        dest_file = os.path.join(PUBLIC_DIR, "user.html")
        if os.path.exists(source_file):
            shutil.copy2(source_file, dest_file)
            print(f"\n{GREEN}Loaded {selected_folder} into /public/user.html{RESET}")
        else:
            print(f"\n{YELLOW}No user.html found in {selected_folder}, continuing with default{RESET}")
        break
    else:
        print("\nInvalid choice, try again.")

# --- URL shortening ---
shorten_url = False
shortener_choice = None
if not local_mode:
    shorten_choice = input(f"\n{CYAN}Shorten URL? (y/n): {RESET}").strip().lower()
    shorten_url = (shorten_choice == 'y')

    if shorten_url:
        print(f"\n{CYAN}Choose a URL shortener: {RESET}\n")
        print(f"{YELLOW}[1]{CYAN} - {GREEN}is.gd{RESET}")
        print(f"{YELLOW}[2]{CYAN} - {GREEN}da.gd{RESET}")
        print(f"{YELLOW}[3]{CYAN} - {GREEN}v.gd{RESET}")
        shortener_choice = input(f"\n{GREEN}>>> {RESET}").strip()
        if shortener_choice not in ['1','2','3']:
            shortener_choice = '1'

# --- Helper functions ---
def enqueue_output(process, queue):
    for line in iter(process.stdout.readline, ''):
        queue.put(line)
    process.stdout.close()

def shorten(long_url):
    try:
        if shortener_choice == '1':
            response = requests.get("https://is.gd/create.php", params={"format":"simple","url":long_url}, timeout=5)
        elif shortener_choice == '2':
            response = requests.get(f"https://da.gd/s?url={long_url}", timeout=5)
        elif shortener_choice == '3':
            response = requests.get("https://v.gd/create.php", params={"format":"simple","url":long_url}, timeout=5)
        else: return None
        if response.status_code == 200:
            return response.text.strip()
    except requests.RequestException as e:
        print(f"{RED}Error shortening URL: {e}{RESET}")
    return None

# --- Graceful shutdown ---
def shutdown(sig=None, frame=None):
    global shutdown_flag
    if shutdown_flag: return
    shutdown_flag = True
    print(f"\n\n{RED}Shutting down...{RESET}")

    for proc, name in [(server, "Node server"), (ssh_process if not local_mode else None, "SSH tunnel")]:
        if proc is None: continue
        try:
            proc.terminate()
            proc.wait(timeout=5)
            print(f"{RED}{name} terminated.{RESET}")
        except Exception:
            try:
                proc.kill()
                print(f"{YELLOW}{name} killed.{RESET}")
            except Exception:
                print(f"{RED}Failed to terminate {name}.{RESET}")

    print(f"{GREEN} \n-Shutdown complete- \n{RESET}")
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

# --- Wait for Node server to listen ---
timeout = 10
start = time.time()
while time.time() - start < timeout:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.connect(("127.0.0.1", PORT))
        s.close()
        print(f"\n\n{CYAN}- STARTING LOCAL SERVER -{MAGENTA}\n\nCtrl+C to shutdown.{RESET}")
        print(f"\n{GREEN}Node server is listening on port {PORT}{RESET}")
        break
    except ConnectionRefusedError:
        time.sleep(0.2)
else:
    print(f"\n{RED}Node server did not start within {timeout} seconds{RESET}")
    shutdown()

# --- Start SSH tunnel selection ---
if not local_mode:
    print(f"\n{CYAN}Select tunneling service:{RESET}\n")
    print(f"{YELLOW}[1]{CYAN} - {GREEN}serveo.net{RESET}")
    print(f"{YELLOW}[2]{CYAN} - {GREEN}localhost.run{RESET}")

    while True:
        tunnel_choice = input(f"\n{GREEN}>>> {RESET}").strip()
        if tunnel_choice == "1":
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-R", f"80:127.0.0.1:{PORT}", "serveo.net"]
            url_regex = r'https?://[^\s]*\.serveo\.net'
            break
        elif tunnel_choice == "2":
            ssh_cmd = [
                "ssh", "-o", "StrictHostKeyChecking=no",
                "-o", "ServerAliveInterval=60",
                "-R", f"80:127.0.0.1:{PORT}",
                "nokey@localhost.run"
            ]
            url_regex = r'https://[a-z0-9]+\.lhr\.life'
            break
        else:
            print(f"\n{YELLOW}Invalid choice, try again.{RESET}")

    ssh_process = subprocess.Popen(
        ssh_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )

# --- Queues & threads ---
node_queue = Queue()
threading.Thread(target=enqueue_output, args=(server, node_queue), daemon=True).start()

if not local_mode:
    ssh_queue = Queue()
    threading.Thread(target=enqueue_output, args=(ssh_process, ssh_queue), daemon=True).start()

# --- Main loop ---
start_time = time.time()
serveo_timeout = 30
ssh_output_buffered = []

try:
    while not shutdown_flag:
        # Node output
        try:
            line = node_queue.get(timeout=0.1)
            print(line, end='')
        except Empty:
            pass

        # SSH output
        if not local_mode:
            try:
                line = ssh_queue.get(timeout=0.1)
                ssh_output_buffered.append(line)
                print(line, end='')

                if serveo_url is None:
                    match = re.search(url_regex, line)
                    if match:
                        serveo_url = match.group(0)
                        ssh_url_to_print = serveo_url  # Store to print later

            except Empty:
                pass

        # Once the banner is done, print the stored tunnel URL
        if ssh_url_to_print:
            print(f"\n\n\n\n\n\n\n{CYAN}- PUBLIC TUNNEL IS ACTIVE -{MAGENTA}\n\nCtrl+C twice to shutdown.{RESET}")
            print(f"\n\n\n\n\n\n\n{CYAN}Tunnel URL:{RESET} {MAGENTA}{ssh_url_to_print}{RESET}\n\n\n\n\n\n\n")
            if shorten_url:
                short_url_val = shorten(ssh_url_to_print)
                if short_url_val:
                    print(f"\n{CYAN}Shortened URL:{RESET} {MAGENTA}{short_url_val}{RESET}\n\n\n\n\n\n\n")
            ssh_url_to_print = None  # Only print once

        # Timeout for Serveo URL
        if not local_mode and serveo_url is None and (time.time() - start_time) > serveo_timeout:
            print(f"\n{YELLOW}Could not find tunnel URL within timeout.{RESET}")
            serveo_url = "timeout"

        # Exit if both processes finished
        if server.poll() is not None and (local_mode or ssh_process.poll() is not None):
            break

except Exception as e:
    print(f"\nError: {e}")
finally:
    shutdown()
