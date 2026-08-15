// State
let socket = null;
let term = null;
let fitAddon = null;
let isConnected = false;
let isWebAuthRequired = false;
let webAuthToken = null;

// xterm.js theme
const termTheme = {
    background: '#0d0d14',
    foreground: '#e4e4ed',
    cursor: '#6c5ce7',
    cursorAccent: '#0d0d14',
    selectionBackground: 'rgba(108, 92, 231, 0.3)',
    black: '#0d0d14',
    red: '#ff4757',
    green: '#2ed573',
    yellow: '#ffa502',
    blue: '#5c7cfa',
    magenta: '#c56cf0',
    cyan: '#17c0eb',
    white: '#e4e4ed',
    brightBlack: '#555570',
    brightRed: '#ff6b81',
    brightGreen: '#7bed9f',
    brightYellow: '#eccc68',
    brightBlue: '#70a1ff',
    brightMagenta: '#d68fff',
    brightCyan: '#7efff5',
    brightWhite: '#ffffff',
};

// Init
window.addEventListener('DOMContentLoaded', () => {
    checkWebAuth();
});

function checkWebAuth() {
    fetch('/api/check-auth', { method: 'POST' })
        .then(r => r.json())
        .then(data => {
            isWebAuthRequired = data.auth_required;
            if (isWebAuthRequired) {
                showScreen('auth-screen');
            } else {
                showScreen('connect-screen');
                initSocket();
            }
        })
        .catch(() => {
            showScreen('connect-screen');
            initSocket();
        });
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

// Web Auth
const authForm = document.getElementById('auth-form');
if (authForm) {
    authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('auth-username').value;
        const password = document.getElementById('auth-password').value;
        const errorEl = document.getElementById('auth-error');

        fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        })
        .then(r => {
            if (!r.ok) throw new Error();
            return r.json();
        })
        .then(() => {
            webAuthToken = btoa(username + ':' + password);
            showScreen('connect-screen');
            initSocket();
        })
        .catch(() => {
            errorEl.textContent = 'Invalid credentials';
            errorEl.classList.remove('hidden');
        });
    });
}

// Socket
function initSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}`;
    
    socket = io(url, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 10,
    });

    socket.on('connect', () => {
        console.log('Socket connected');
    });

    socket.on('connected', (data) => {
        console.log('Server confirmed:', data.sid);
    });

    socket.on('ssh_data', (data) => {
        if (term) {
            term.write(data.data);
        }
    });

    socket.on('ssh_connected', (data) => {
        isConnected = true;
        document.getElementById('connection-info').textContent = 
            `${data.username}@${data.host}`;
        showScreen('terminal-screen');
        initTerminal();
        hideError('connect-error');
        setConnectBtn(false);
    });

    socket.on('ssh_error', (data) => {
        showError('connect-error', data.message);
        setConnectBtn(false);
    });

    socket.on('ssh_disconnected', (data) => {
        isConnected = false;
        if (term) {
            term.write('\r\n\x1b[33m[Disconnected]\x1b[0m\r\n');
        }
    });

    socket.on('disconnect', () => {
        isConnected = false;
        console.log('Socket disconnected');
    });
}

// Terminal
function initTerminal() {
    const terminalEl = document.getElementById('terminal');
    terminalEl.innerHTML = '';

    term = new Terminal({
        theme: termTheme,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: 14,
        lineHeight: 1.3,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 10000,
        allowProposedApi: true,
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon.WebLinksAddon());

    term.open(terminalEl);

    // Fit after a small delay to ensure DOM is ready
    setTimeout(() => {
        fitAddon.fit();
        socket.emit('resize', {
            cols: term.cols,
            rows: term.rows
        });
    }, 100);

    term.onData((data) => {
        if (socket && isConnected) {
            socket.emit('ssh_input', { data });
        }
    });

    term.onResize(({ cols, rows }) => {
        if (socket && isConnected) {
            socket.emit('resize', { cols, rows });
        }
    });

    // Handle window resize
    const resizeObserver = new ResizeObserver(() => {
        if (fitAddon && term) {
            fitAddon.fit();
        }
    });
    resizeObserver.observe(terminalEl);
}

// Connect Form
const connectForm = document.getElementById('connect-form');
if (connectForm) {
    connectForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!socket || !socket.connected) {
            showError('connect-error', 'Socket not connected. Retrying...');
            initSocket();
            return;
        }

        setConnectBtn(true, true);
        hideError('connect-error');

        const connectData = {
            host: document.getElementById('ssh-host').value.trim(),
            port: parseInt(document.getElementById('ssh-port').value) || 22,
            username: document.getElementById('ssh-username').value.trim(),
            password: document.getElementById('ssh-password').value,
            private_key: document.getElementById('ssh-private-key').value.trim(),
        };

        socket.emit('ssh_connect', connectData);

        // Timeout for connection
        setTimeout(() => {
            if (!isConnected) {
                setConnectBtn(false);
            }
        }, 15000);
    });
}

function disconnectSSH() {
    if (socket) {
        socket.emit('ssh_disconnect');
    }
    isConnected = false;
    if (term) {
        term.dispose();
        term = null;
    }
    showScreen('connect-screen');
    setConnectBtn(false);
}

function copyTerminal() {
    if (term) {
        const selection = term.getSelection();
        if (selection) {
            navigator.clipboard.writeText(selection).then(() => {
                // Brief visual feedback could go here
            });
        }
    }
}

async function pasteTerminal() {
    if (term && socket && isConnected) {
        try {
            const text = await navigator.clipboard.readText();
            socket.emit('ssh_input', { data: text });
        } catch (e) {
            // Clipboard access denied
        }
    }
}

function togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        btn.style.color = 'var(--accent)';
    } else {
        input.type = 'password';
        btn.style.color = '';
    }
}

function showError(id, msg) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.classList.remove('hidden');
}

function hideError(id) {
    const el = document.getElementById(id);
    el.classList.add('hidden');
}

function setConnectBtn(loading) {
    const btn = connectForm.querySelector('.btn-connect');
    if (loading) {
        btn.classList.add('loading');
    } else {
        btn.classList.remove('loading');
    }
}