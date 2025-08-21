import json
import getpass
import subprocess
import os

CONFIG_FILE = "config.json"

# Prompt for username and password (strip whitespace)
username = input("Enter admin username: ").strip()
password = getpass.getpass("Enter admin password: ").strip()

# Use Node.js scrypt hashing via inline script
node_script = """
const crypto = require('crypto');

const password = process.argv[1];
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
console.log(`${salt}:${hash}`);
"""

result = subprocess.run(
    ['node', '-e', node_script, password],
    capture_output=True, text=True
)

if result.returncode != 0:
    print("Error hashing password:", result.stderr)
    exit(1)

hashed = result.stdout.strip()  # remove newlines/spaces

# Save config.json
config = {
    "adminUser": username,
    "adminHash": hashed
}

with open(CONFIG_FILE, 'w') as f:
    json.dump(config, f, indent=2)

print(f"Config saved to {os.path.abspath(CONFIG_FILE)}")
