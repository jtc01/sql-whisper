UW PICO 5.09                                                                                                    File: SLOP_MATTHEW.md

Yes — frontend can do everything with the ngrok URL right now. Replace http://localhost:5001 with https://earphone-opossum-settling.ngrok-free.dev and every endpoint we've built works (connections, history, query, schema).
The only things he can't do yet:
    1    TRTC voice endpoints — those are 404'ing per your earlier test. Need to fix.
    2    /ask endpoint — LLM teammate is still wiring it up.
Everything else (the entire data layer, history sidebar, add-a-database form, query results rendering with hardcoded SQL via /query) — fully functional through ngrok.
Practical message to send him:
ngrok is live. Replace localhost with https://earphone-opossum-settling.ngrok-free.dev and you can wire /connections, /history, /schema, /query right now. /ask is still in progress with LLM teammate. TRTC endpoints are 404'ing — I'm deb$
One important caveat to flag: first request through ngrok shows an interstitial page in browsers asking to confirm visiting the URL. For programmatic requests (his fetch calls), it'll show up as a weird HTML response instead of JSON. Ea$
fetch(url, {
  headers: { 'ngrok-skip-browser-warning': 'true', ... },
  ...
})
Tell him that or he'll spend 10 minutes wondering why responses look like HTML.

Now back to the 404 — that's blocking your TRTC integration. Run the grep I asked for:
cd ~/Development/Hackathons/Hack-A-Stack_2026/sql-whisper/backend
grep -n "trtc/usersig\|if __name__" app.py
Paste output. Should be 2-3 lines. That tells me in 5 seconds whether the routes are in the wrong place, missing entirely, or something else.
Also check the Flask terminal — any error messages or stack traces visible? Paste those too if so.

This is the "Add a Database" modal — he's wiring it to your POST /connections endpoint. Looks slick. Let me map exactly what his form fields need to send.
Field mapping (his label → your API field):
UI label
API field
Required
Notes
SOURCE ALIAS
name
yes
"PRODUCTION_CLUSTER"
HOSTNAME / VECTOR IP
host
yes
"db.nexus.core"
PORT
port
optional
integer, defaults to 3306 if omitted
INITIAL SCHEMA
db_name
yes
"main_registry" — this is the database name
(SECURITY & AUTH tab) USERNAME
username
yes
not in this screenshot
(SECURITY & AUTH tab) PASSWORD
password
yes

^G Get Help                            ^O WriteOut                            ^R Read File                           ^Y Prev Pg                             ^K Cut Text                            ^C Cur Pos
^X Exit                                ^J Justify                             ^W Where is                            ^V Next Pg                             ^U UnCut Text                          ^T To Spell
