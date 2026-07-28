import asyncio
import base64
import time
import os
import discord
from flask import Flask, jsonify, render_template, request
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

TOKEN = os.getenv("DISCORD_TOKEN")
CATEGORY_ID = int(os.getenv("CATEGORY_ID", "0"))

# Your Discord User IDs to mention on new tickets
ADMIN_IDS = ["897171604008763462", "1396131779613823097"]

intents = discord.Intents.default()
intents.message_content = True
intents.guilds = True
intents.members = True
client = discord.Client(intents=intents)

active_chats = {}
channel_to_visitor = {}
banned_users = set()
muted_users = set()

CANNED_RESPONSES = {
    "!hello": "Hello! Welcome to support. How can we assist you today?",
    "!refund": "Please note that all sales are final as stated in our terms of service.",
    "!faq": "Please check our documentation/FAQ page for common troubleshooting steps.",
    "!thanks": "Thank you for contacting us! If you need anything else, feel free to ask.",
    "!status": "🟢 All software is currently online, updating normally, and undetected.",
    "!pricing": "🛒 Please check our store section for current pricing and subscription tiers."
}

USER_BOT_COMMANDS = {
    "!status": "🟢 All software is currently online, updating normally, and undetected.",
    "!pricing": "🛒 Please check our store section for current pricing and subscription tiers."
}

BAD_KEYWORDS = ["scam", "free nitro", "discord.gg/", "http://", "https://"]

@client.event
async def on_ready():
    print(f"Discord Bot logged in as {client.user}")

@client.event
async def on_message(message):
    if message.author == client.user: 
        return
    
    content = message.content.strip()
    channel_id = message.channel.id

    if content.startswith("!ban"):
        parts = content.split(" ")
        target_id = parts[1] if len(parts) > 1 else channel_to_visitor.get(channel_id)
        if target_id:
            banned_users.add(target_id)
            await message.channel.send(f"🚫 **User `{target_id}` has been banned.**")
            if target_id in active_chats:
                active_chats[target_id]["messages"].append({"sender": "system_close", "text": "Your chat has been banned.", "event": "ban"})
        return

    if content.startswith("!mute"):
        target_id = channel_to_visitor.get(channel_id)
        if target_id:
            muted_users.add(target_id)
            await message.channel.send(f"🔇 **User has been muted from sending messages.**")
        return

    if content == "!close" and channel_id in channel_to_visitor:
        visitor_id = channel_to_visitor[channel_id]
        if visitor_id in active_chats:
            active_chats[visitor_id]["messages"].append({"sender": "system_close", "text": "Ticket closed.", "event": "close"})
            await message.channel.send("🔒 Closing ticket...")
            await asyncio.sleep(2)
            await message.channel.delete()
            del channel_to_visitor[channel_id]
            del active_chats[visitor_id]
        return

    if channel_id in channel_to_visitor:
        visitor_id = channel_to_visitor[channel_id]
        
        if visitor_id in active_chats and not active_chats[visitor_id].get("admin_joined"):
            active_chats[visitor_id]["admin_joined"] = True
            active_chats[visitor_id]["messages"].append({"sender": "system", "text": "An agent has joined the chat.", "event": "join"})

        if content in CANNED_RESPONSES and visitor_id in active_chats:
            text_to_send = CANNED_RESPONSES[content]
            active_chats[visitor_id]["messages"].append({"sender": "admin", "role": "[Support]", "text": text_to_send, "files": [], "event": "msg"})
            await message.channel.send(f"✅ *Canned Response Sent*")
            return

        if visitor_id in active_chats and content:
            msg_data = {"sender": "admin", "role": "[Support]", "text": content, "files": [], "event": "msg"}
            for attachment in message.attachments: 
                msg_data["files"].append(attachment.url)
            active_chats[visitor_id]["messages"].append(msg_data)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/status", methods=["GET"])
def check_status():
    visitor_id = request.args.get("visitor_id")
    if visitor_id in banned_users: 
        return jsonify({"banned": True})
    if visitor_id and visitor_id not in active_chats: 
        return jsonify({"active": False, "closed": True})
    return jsonify({"active": True, "banned": False, "closed": False})

@app.route("/start", methods=["POST"])
def start_chat():
    data = request.json
    visitor_id = data.get("visitor_id")
    name = data.get("name")
    email = data.get("email", "Not provided")
    department = data.get("department", "General")
    order_id = data.get("order_id", "")
    sys_data = data.get("sys_data", {})

    ip_address = request.headers.get("X-Forwarded-For", request.remote_addr)
    gpu = sys_data.get("gpu", "Unknown GPU")
    cores = sys_data.get("cores", "Unknown CPU")
    ram = sys_data.get("ram", "Unknown RAM")
    res = sys_data.get("resolution", "Unknown Res")
    os_ver = sys_data.get("os_version", "Unknown OS")

    if visitor_id in banned_users: 
        return jsonify({"banned": True})

    async def create_chan():
        guild = client.guilds[0] if client.guilds else None
        if guild:
            channel_name = ("chat-" + "".join(c if c.isalnum() else "-" for c in name)).lower()[:25]
            category = discord.utils.get(guild.categories, id=CATEGORY_ID)
            new_channel = await guild.create_text_channel(channel_name, category=category)

            active_chats[visitor_id] = {
                "name": name, 
                "department": department, 
                "channel_id": new_channel.id,
                "messages": [], 
                "last_active": time.time(), 
                "admin_joined": False,
                "user_typing": False
            }
            channel_to_visitor[new_channel.id] = visitor_id

            embed = discord.Embed(
                title=f"🎫 Ticket: {department}",
                description="**📋 Admin Commands Guide:**\n`!status` - System status\n`!pricing` - Store pricing\n`!mute` - Mute user\n`!ban` - Ban user\n`!close` - Close ticket",
                color=0x5865F2,
                timestamp=discord.utils.utcnow()
            )
            embed.set_author(name=name)
            embed.add_field(name="👤 User Identity", value=f"**Name:** `{name}`\n**Email/Username:** `{email}`\n**Visitor ID:** `{visitor_id}`", inline=False)
            
            if order_id:
                embed.add_field(name="💳 License / Order", value=f"`{order_id}`", inline=False)
                
            embed.add_field(name="🖥️ Hardware", value=f"**GPU:** `{gpu}`\n**CPU:** `{cores}`\n**RAM:** `{ram}`", inline=False)
            embed.add_field(name="⚙️ System", value=f"**OS:** `{os_ver}`\n**Display:** `{res}`", inline=True)
            embed.add_field(name="🌍 Network", value=f"**IP:** `{ip_address}`", inline=True)
            
            # Format mentions string for both of your IDs
            mentions_text = " ".join([f"<@{uid}>" for uid in ADMIN_IDS])
            
            await new_channel.send(content=f"🔔 **New Support Ticket Opened!** {mentions_text}", embed=embed)

    try:
        future = asyncio.run_coroutine_threadsafe(create_chan(), client.loop)
        future.result(timeout=10)
    except Exception as e:
        print(f"Error creating channel: {e}")
        return jsonify({"error": "Failed to create Discord channel. Ensure bot is ready."}), 500

    return jsonify({"banned": False})

@app.route("/send", methods=["POST"])
def send_to_discord():
    data = request.json
    visitor_id = data.get("visitor_id")
    user_message = data.get("message", "")
    file_data = data.get("file")
    filename = data.get("filename")

    if visitor_id in banned_users: 
        return jsonify({"banned": True})
    if visitor_id in muted_users:
        return jsonify({"banned": False, "bot_reply": "⚠️ You are currently muted by support."})

    if any(word in user_message.lower() for word in BAD_KEYWORDS):
        banned_users.add(visitor_id)
        return jsonify({"banned": True})

    if visitor_id in active_chats: 
        active_chats[visitor_id]["last_active"] = time.time()
        active_chats[visitor_id]["user_typing"] = False

    bot_reply = USER_BOT_COMMANDS.get(user_message) if user_message.startswith("!") else None

    async def post_msg():
        if visitor_id in active_chats:
            channel = client.get_channel(active_chats[visitor_id]["channel_id"])
            if channel:
                # Fetch the visitor's name stored during ticket creation
                user_display_name = active_chats[visitor_id].get("name", "User")
                
                if bot_reply:
                    await channel.send(f"🤖 *User triggered command:* `{user_message}`")
                elif file_data:
                    import io
                    header, encoded = file_data.split(",", 1)
                    f = discord.File(io.BytesIO(base64.b64decode(encoded)), filename=filename)
                    # Use name & visitor ID instead of just 💬
                    await channel.send(content=f"💬 **{user_display_name}** (`{visitor_id}`): {user_message}" if user_message else f"💬 **{user_display_name}** (`{visitor_id}`): [File Uploaded]", file=f)
                elif user_message:
                    async with channel.typing():
                        # Use name & visitor ID instead of just 💬
                        await channel.send(f"💬 **{user_display_name}** (`{visitor_id}`): {user_message}")
    try:
        asyncio.run_coroutine_threadsafe(post_msg(), client.loop)
    except Exception:
        pass

    return jsonify({"banned": False, "bot_reply": bot_reply})

@app.route("/typing", methods=["POST"])
def user_typing():
    data = request.json
    visitor_id = data.get("visitor_id")
    is_typing = data.get("typing", False)
    if visitor_id in active_chats:
        active_chats[visitor_id]["user_typing"] = is_typing
    return jsonify({"status": "ok"})

@app.route("/poll", methods=["GET"])
def poll_messages():
    visitor_id = request.args.get("visitor_id")
    if visitor_id in banned_users: 
        return jsonify({"banned": True})
    if visitor_id not in active_chats: 
        return jsonify({"closed": True})
    
    msgs = active_chats[visitor_id]["messages"]
    active_chats[visitor_id]["messages"] = []
    is_user_typing = active_chats[visitor_id].get("user_typing", False)

    return jsonify({
        "messages": msgs, 
        "admin_typing": False, 
        "banned": False, 
        "closed": False,
        "user_typing": is_user_typing
    })

def inactivity_cleaner():
    while True:
        time.sleep(60)
        curr = time.time()
        for vid, info in list(active_chats.items()):
            if curr - info["last_active"] > 86400:
                async def close_chan(cid, v):
                    ch = client.get_channel(cid)
                    if ch:
                        await ch.send("🔒 **Closed due to inactivity.**")
                        await asyncio.sleep(2)
                        await ch.delete()
                    if v in active_chats:
                        active_chats[v]["messages"].append({"sender": "system_close", "text": "Closed.", "event": "close"})
                        del active_chats[v]
                    if cid in channel_to_visitor: 
                        del channel_to_visitor[cid]
                try:
                    asyncio.run_coroutine_threadsafe(close_chan(info["channel_id"], vid), client.loop)
                except Exception:
                    pass

if __name__ == "__main__":
    import threading
    threading.Thread(target=lambda: client.run(TOKEN), daemon=True).start()
    threading.Thread(target=inactivity_cleaner, daemon=True).start()
    app.run(port=5000, debug=False)
