import os
import uuid
import paramiko
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', os.urandom(24).hex())

# SocketIO with CORS support
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet',
                    ping_timeout=60, ping_interval=25)

# Store active SSH sessions per socket session
sessions = {}

# Optional auth
AUTH_USER = os.environ.get('AUTH_USER', '')
AUTH_PASS = os.environ.get('AUTH_PASS', '')


def get_ssh_client():
    """Create and return a new paramiko SSH client."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    return client


def check_auth(username, password):
    """Check web auth credentials if configured."""
    if not AUTH_USER:
        return True
    return username == AUTH_USER and password == AUTH_PASS


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/check-auth', methods=['POST'])
def check_auth_route():
    """Check if web auth is required."""
    return jsonify({'auth_required': bool(AUTH_USER)})


@app.route('/api/login', methods=['POST'])
def login():
    """Web authentication endpoint."""
    data = request.get_json()
    if check_auth(data.get('username', ''), data.get('password', '')):
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': 'Invalid credentials'}), 401


@socketio.on('connect')
def handle_connect():
    print(f'[+] Client connected: {request.sid}')
    emit('connected', {'sid': request.sid})


@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    print(f'[-] Client disconnected: {sid}')
    if sid in sessions:
        try:
            sessions[sid]['client'].close()
        except Exception:
            pass
        del sessions[sid]


@socketio.on('ssh_connect')
def handle_ssh_connect(data):
    """Handle SSH connection request from client."""
    sid = request.sid
    host = data.get('host', '').strip()
    port = int(data.get('port', 22))
    username = data.get('username', '').strip()
    password = data.get('password', '')
    private_key = data.get('private_key', '').strip()
    term_cols = int(data.get('cols', 80))
    term_rows = int(data.get('rows', 24))

    if not host or not username:
        emit('ssh_error', {'message': 'Host and username are required'})
        return

    try:
        client = get_ssh_client()

        # Connect with password or key
        if private_key:
            import io
            key_file = io.StringIO(private_key)
            pkey = None
            for key_class in [paramiko.RSAKey, paramiko.ECDSAKey, paramiko.Ed25519Key]:
                try:
                    pkey = key_class.from_private_key(key_file, password=password or None)
                    break
                except paramiko.SSHException:
                    key_file.seek(0)
                    continue
            if not pkey:
                emit('ssh_error', {'message': 'Invalid private key format'})
                return
            client.connect(hostname=host, port=port, username=username, pkey=pkey,
                           timeout=15, allow_agent=False, look_for_keys=False)
        else:
            client.connect(hostname=host, port=port, username=username, password=password,
                           timeout=15, allow_agent=False, look_for_keys=False)

        # Open interactive shell
        channel = client.invoke_shell(term='xterm-256color', width=term_cols, height=term_rows)
        channel.setblocking(0)

        sessions[sid] = {
            'client': client,
            'channel': channel,
            'host': host,
            'username': username
        }

        emit('ssh_connected', {
            'message': f'Connected to {username}@{host}:{port}',
            'host': host,
            'username': username
        })

        # Start reading output
        read_ssh_output(sid)

    except paramiko.AuthenticationException:
        emit('ssh_error', {'message': 'Authentication failed. Check credentials.'})
    except paramiko.SSHException as e:
        emit('ssh_error', {'message': f'SSH error: {str(e)}'})
    except Exception as e:
        emit('ssh_error', {'message': f'Connection failed: {str(e)}'})


def read_ssh_output(sid):
    """Non-blocking read from SSH channel and emit to client."""
    import eventlet
    if sid not in sessions:
        return

    try:
        channel = sessions[sid]['channel']
        while True:
            if sid not in sessions:
                break
            eventlet.sleep(0.01)
            if channel.recv_ready():
                data = channel.recv(4096)
                if data:
                    socketio.emit('ssh_data', {'data': data.decode('utf-8', errors='replace')}, room=sid)
            if channel.recv_stderr_ready():
                data = channel.recv_stderr(4096)
                if data:
                    socketio.emit('ssh_data', {'data': data.decode('utf-8', errors='replace')}, room=sid)
            if channel.exit_status_ready():
                exit_code = channel.recv_exit_status()
                socketio.emit('ssh_data', {'data': f'\r\n[Process exited with code {exit_code}]\r\n'}, room=sid)
                socketio.emit('ssh_disconnected', {'message': 'Connection closed'}, room=sid)
                if sid in sessions:
                    try:
                        sessions[sid]['client'].close()
                    except Exception:
                        pass
                    del sessions[sid]
                break
    except Exception as e:
        if sid in sessions:
            socketio.emit('ssh_error', {'message': f'Session error: {str(e)}'}, room=sid)
            try:
                sessions[sid]['client'].close()
            except Exception:
                pass
            del sessions[sid]


@socketio.on('ssh_input')
def handle_ssh_input(data):
    """Send input from browser terminal to SSH channel."""
    sid = request.sid
    if sid in sessions:
        try:
            sessions[sid]['channel'].send(data.get('data', ''))
        except Exception as e:
            emit('ssh_error', {'message': f'Input error: {str(e)}'})


@socketio.on('resize')
def handle_resize(data):
    """Handle terminal resize."""
    sid = request.sid
    if sid in sessions:
        try:
            sessions[sid]['channel'].resize_pty(
                width=int(data.get('cols', 80)),
                height=int(data.get('rows', 24))
            )
        except Exception:
            pass


@socketio.on('ssh_disconnect')
def handle_ssh_disconnect():
    """Disconnect SSH session."""
    sid = request.sid
    if sid in sessions:
        try:
            sessions[sid]['client'].close()
        except Exception:
            pass
        del sessions[sid]
        emit('ssh_disconnected', {'message': 'Disconnected'})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    print(f'[*] SSH Web Terminal running on port {port}')
    socketio.run(app, host='0.0.0.0', port=port, debug=debug)
