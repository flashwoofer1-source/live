let visitorId = localStorage.getItem('visitorId');
let userName = localStorage.getItem('userName');
let typingTimeout;

if (window.Notification && Notification.permission !== "granted") {
    Notification.requestPermission();
}

const translations = {
    en: { welcome: "Welcome!", sub: "Please fill out the details below to connect with an agent.", start: "Start Chat" },
    es: { welcome: "¡Bienvenido!", sub: "Complete los detalles a continuación para conectarse.", start: "Iniciar Chat" }
};

function changeLanguage() {
    const lang = document.getElementById('lang-select').value;
    document.getElementById('txt-welcome').innerText = translations[lang].welcome;
    document.getElementById('txt-sub').innerText = translations[lang].sub;
    document.getElementById('btn-start').innerText = translations[lang].start;
}

function checkDept() {
    const dept = document.getElementById('dept-select').value;
    const orderDiv = document.getElementById('order-id-div');
    orderDiv.style.display = (dept === 'Payment / License Issue') ? 'flex' : 'none';
}

// Check session status immediately on page load
window.addEventListener('DOMContentLoaded', async () => {
    if (visitorId && userName) {
        await checkStatusOnLoad();
    }
});

function toggleChat() {
    const win = document.getElementById('chat-window');
    win.style.display = win.style.display === 'flex' ? 'none' : 'flex';
    if(win.style.display === 'flex') {
        const msgs = document.getElementById('chat-messages');
        msgs.scrollTop = msgs.scrollHeight;
    }
}

async function checkStatusOnLoad() {
    try {
        let res = await fetch('/status?visitor_id=' + visitorId);
        let data = await res.json();
        
        if (data.banned) {
            localStorage.removeItem('visitorId');
            localStorage.removeItem('userName');
            triggerBanState();
            return;
        } 
        
        if (data.closed || !data.active) {
            localStorage.removeItem('visitorId');
            localStorage.removeItem('userName');
            visitorId = null;
            userName = null;
            document.getElementById('pre-chat').style.display = 'block';
            document.getElementById('chat-main').style.display = 'none';
            return;
        }

        if (data.active) {
            document.getElementById('pre-chat').style.display = 'none';
            document.getElementById('chat-main').style.display = 'flex';

            // If your backend returns message history on reconnect, load them here:
            if (data.messages && data.messages.length > 0) {
                data.messages.forEach(m => {
                    if (m.sender === 'user') {
                        appendMsg(m.text, 'user', m.file, m.filename);
                    } else if (m.sender === 'system') {
                        appendMsg(m.text, 'system');
                    } else {
                        let files = m.files || [];
                        appendMsg(m.text, 'admin', files[0] || null, files[0] ? "Attachment" : null, m.role);
                    }
                });
            }
        }
    } catch (e) {
        console.error("Failed to verify active session", e);
    }
}

async function startChat() {
    const startBtn = document.getElementById('btn-start');
    
    // Prevent spam clicking by immediately disabling the button
    if (startBtn.disabled) return;
    
    const nameInput = document.getElementById('user-name-input').value.trim();
    const emailInput = document.getElementById('user-email-input').value.trim();
    const department = document.getElementById('dept-select').value;
    const orderId = document.getElementById('order-id-input').value.trim();
    
    if(!nameInput) return alert('Please enter your name.');
    if(!emailInput) return alert('Please enter your email or username.');

    startBtn.disabled = true;
    startBtn.innerText = "Connecting...";

    const sysData = await getDeepSystemFingerprint();

    userName = nameInput;
    visitorId = 'user_' + Math.random().toString(36).substring(2);
    localStorage.setItem('visitorId', visitorId);
    localStorage.setItem('userName', userName);

    try {
        let res = await fetch('/start', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                visitor_id: visitorId, 
                name: userName, 
                email: emailInput, 
                department: department, 
                order_id: orderId,
                sys_data: sysData
            })
        });
        let data = await res.json();

        if(data.banned) { 
            triggerBanState(); 
            return; 
        }

        document.getElementById('pre-chat').style.display = 'none';
        document.getElementById('chat-main').style.display = 'flex';
    } catch(e) {
        startBtn.disabled = false;
        startBtn.innerText = "Start Chat";
        alert("Connection error. Please try again.");
    }
}

function updateFileName() {
    const f = document.getElementById('file-input').files[0];
    const errorSpan = document.getElementById('file-error');
    if(f) {
        const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase();
        const blocked = ['.exe', '.bat', '.cmd', '.vbs', '.scr', '.pif'];
        if (blocked.includes(ext)) {
            errorSpan.innerText = "⚠️ Invalid format";
            errorSpan.style.display = 'inline';
            document.getElementById('file-input').value = '';
            document.getElementById('file-name-text').innerText = "Attach File";
            return;
        }
        errorSpan.style.display = 'none';
        document.getElementById('file-name-text').innerText = f.name.length > 15 ? f.name.substring(0,15) + '...' : f.name;
    } else {
        document.getElementById('file-name-text').innerText = "Attach File";
    }
}

async function sendMessage() {
    const input = document.getElementById('msg-input');
    const fileInput = document.getElementById('file-input');
    const text = input.value.trim();
    const file = fileInput.files[0];

    if(!text && !file) return;

    let fileData = null;
    let fileName = null;

    if (file) {
        fileName = file.name;
        fileData = await toBase64(file);
    }

    appendMsg(text, 'user', fileData, fileName);
    input.value = '';
    fileInput.value = '';
    document.getElementById('file-name-text').innerText = "Attach File";

    let res = await fetch('/send', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({visitor_id: visitorId, message: text, file: fileData, filename: fileName})
    });
    let data = await res.json();
    if(data.banned) {
        triggerBanState();
    } else if(data.bot_reply) {
        appendMsg(data.bot_reply, 'support');
        playSound('msg');
    }
}

async function triggerQuickAction(command) {
    appendMsg(command, 'user');
    let res = await fetch('/send', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({visitor_id: visitorId, message: command})
    });
    let data = await res.json();
    if(data.banned) {
        triggerBanState();
    } else if(data.bot_reply) {
        appendMsg(data.bot_reply, 'support');
        playSound('msg');
    }
}

function toBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

function appendMsg(text, sender, fileUrl = null, fileName = null, role = "") {
    const body = document.getElementById('chat-messages');
    
    if (sender === 'system') {
        const sysDiv = document.createElement('div');
        sysDiv.className = 'msg system';
        sysDiv.innerText = text;
        body.appendChild(sysDiv);
        body.scrollTop = body.scrollHeight;
        return;
    }

    const div = document.createElement('div');
    div.className = 'msg ' + sender;
    
    let innerHTML = '';
    
    if (sender === 'admin' || sender === 'support') {
        let initial = role ? role.charAt(1) : 'S';
        innerHTML += `<div class="msg-avatar">${initial}</div>`;
    }

    innerHTML += `<div class="msg-content">`;
    if(sender === 'admin' && role) {
        innerHTML += `<b style="color:var(--admin-color); font-size:11px; display:block; margin-bottom:4px;">${role}</b>`;
    }
    if(text) innerHTML += text;
    if(fileUrl) {
        if(fileName && fileName.match(/\.(jpeg|jpg|gif|png)$/i)) {
            innerHTML += `<br><img src="${fileUrl}" style="max-width:100%; border-radius:8px; margin-top:8px;">`;
        } else {
            innerHTML += `<br><a href="${fileUrl}" download="${fileName}" style="color:inherit; font-weight:bold; display:flex; align-items:center; gap:4px; margin-top:8px;">📎 ${fileName}</a>`;
        }
    }
    innerHTML += `</div>`;
    
    div.innerHTML = innerHTML;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
}

function playSound(event) {
    if (event === 'msg') document.getElementById('sound-msg').play().catch(e=>{});
    if (event === 'join') document.getElementById('sound-join').play().catch(e=>{});
    if (event === 'close') document.getElementById('sound-close').play().catch(e=>{});
}

function sendTyping() {
    fetch('/typing', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({visitor_id: visitorId, typing: true}) });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        fetch('/typing', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({visitor_id: visitorId, typing: false}) });
    }, 2000);
}

function triggerBanState() {
    localStorage.removeItem('visitorId');
    localStorage.removeItem('userName');
    document.getElementById('chat-main').style.display = 'none';
    document.getElementById('pre-chat').style.display = 'none';
    document.getElementById('banned-screen').style.display = 'flex';
}

async function pollMessages() {
    if (!visitorId) return;
    try {
        let res = await fetch('/poll?visitor_id=' + visitorId);
        let data = await res.json();
        
        if(data.banned) { triggerBanState(); return; }
        if(data.closed) {
            // If closed by admin while polling, clear session and reset view
            localStorage.removeItem('visitorId');
            localStorage.removeItem('userName');
            visitorId = null;
            userName = null;
            document.getElementById('chat-main').style.display = 'none';
            document.getElementById('pre-chat').style.display = 'block';
            return;
        }

        document.getElementById('typing-indicator').innerText = data.admin_typing ? "Agent is typing..." : "";

        if(data.messages && data.messages.length > 0) {
            data.messages.forEach(m => {
                playSound(m.event || 'msg');
                if (m.event === 'close' || m.sender === 'system_close') {
                    localStorage.removeItem('visitorId');
                    localStorage.removeItem('userName');
                    visitorId = null;
                    userName = null;
                    document.getElementById('chat-main').style.display = 'none';
                    document.getElementById('pre-chat').style.display = 'block';
                    return;
                }
                if (m.sender === 'system') {
                    appendMsg(m.text, 'system');
                } else {
                    let files = m.files || [];
                    appendMsg(m.text, 'admin', files[0] || null, files[0] ? "Attachment" : null, m.role);
                    if (window.Notification && Notification.permission === "granted") {
                        new Notification("Support Reply", { body: m.text || "New attachment received" });
                    }
                }
            });
        }
    } catch(e) {}
}

async function getDeepSystemFingerprint() {
    let gpu = 'Unknown GPU';
    try {
        let canvas = document.createElement('canvas');
        let gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
            let debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                gpu = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
            }
        }
    } catch (e) {}

    let osVersion = navigator.platform;
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        try {
            let ua = await navigator.userAgentData.getHighEntropyValues(["platformVersion"]);
            osVersion = `Windows NT ${ua.platformVersion}`;
        } catch (e) {}
    }

    return {
        gpu: gpu,
        cores: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} Cores` : 'Unknown CPU',
        ram: navigator.deviceMemory ? `${navigator.deviceMemory}GB+ RAM` : 'Unknown RAM',
        resolution: `${window.screen.width}x${window.screen.height}`,
        os_version: osVersion,
        language: navigator.language
    };
}

setInterval(pollMessages, 3000);