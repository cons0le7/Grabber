import subprocess
import threading
import re
import requests
import sys
import signal
import os
from queue import Queue, Empty
import time

PORT = 3000
serveo_url = None
shutdown_flag = False

# Function to kill processes using PORT
def kill_port(port):
    try:
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        pids = result.stdout.strip().split("\n")
        for pid in pids:
            if pid:
                print(f"Killing process {pid} using port {port}...")
                os.kill(int(pid), signal.SIGKILL)
    except Exception:
        pass  # no process to kill

# Kill any process using PORT before starting
kill_port(PORT)

# Ask user if they want to shorten URL (default: no)
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

# Helper to read lines from a process and put them in a queue
def enqueue_output(process, queue):
    for line in iter(process.stdout.readline, ''):
        queue.put(line)
    process.stdout.close()

# Function to shorten URL using chosen service
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
        else:
            print("Failed to shorten URL")
            return None
    except requests.RequestException as e:
        print(f"Error shortening URL: {e}")
        return None

# Function to handle graceful shutdown
def shutdown(sig=None, frame=None):
    global shutdown_flag
    if shutdown_flag:
        return
    shutdown_flag = True
    print("\nShutting down...")

    # Kill Node server
    try:
        server.kill()
        server.wait(timeout=5)
    except Exception:
        pass

    # Kill SSH tunnel
    try:
        ssh_process.kill()
        ssh_process.wait(timeout=5)
    except Exception:
        pass

    # Kill any lingering processes on port 3000
    kill_port(PORT)
    sys.exit(0)

signal.signal(signal.SIGINT, shutdown)
signal.signal(signal.SIGTERM, shutdown)

# Start Node server
server = subprocess.Popen(
    ["node", "server.js"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1
)

# Start SSH tunnel to Serveo
ssh_process = subprocess.Popen(
    ["ssh", "-o", "StrictHostKeyChecking=no", f"-R", f"80:localhost:{PORT}", "serveo.net"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1
)

# Queues for output
node_queue = Queue()
ssh_queue = Queue()

# Start threads to enqueue output
threading.Thread(target=enqueue_output, args=(server, node_queue), daemon=True).start()
threading.Thread(target=enqueue_output, args=(ssh_process, ssh_queue), daemon=True).start()

# Main loop: interleave output and detect Serveo URL
timeout = 30
start_time = None

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

            # Detect Serveo URL
            if serveo_url is None:
                match = re.search(r'https?://[^\s]+', line)
                if match:
                    serveo_url = match.group(0)
                    print(f"""
\nServeo URL: {serveo_url}""")

                    if shorten_url:
                        short_url = shorten(serveo_url)
                        if short_url:
                            print(f"""
        \nShortened URL: {short_url}\n""")

                    start_time = time.time()
        except Empty:
            pass

        # Exit if both processes finished
        if server.poll() is not None and ssh_process.poll() is not None:
            break

        # Timeout for Serveo URL detection
        if serveo_url is None and start_time is not None and (time.time() - start_time) > timeout:
            print("\nCould not find Serveo URL within timeout.")
            serveo_url = "timeout"

except Exception as e:
    print(f"\nError: {e}")
finally:
    shutdown()
