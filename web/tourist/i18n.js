// UI strings. Add more languages (Assamese, Bengali, Khasi...) by adding a key to STRINGS.
const STRINGS = {
  en: {
    app: "Suraksha", online: "Online", offline: "Offline",
    regTitle: "Register your trip", regSub: "You get a digital tourist ID linked to your safety band. Police can only see this information during an emergency.",
    fName: "Full name", fPhone: "Phone", fNat: "Nationality", fDoc: "Aadhaar / Passport no.", fBlood: "Blood group", fBand: "Band ID",
    fMed: "Medical notes", fEName: "Emergency contact", fEPhone: "Contact phone", fStart: "Trip start", fEnd: "Trip end",
    fItin: "Places you plan to visit", regBtn: "Create my digital ID", haveId: "Already registered?", open: "Open",
    hello: "Stay safe,", hold: "Hold 3 seconds", police: "Emergency", helpline: "Tourist helpline", family: "Family",
    band: "Safety band", pair: "Pair via Bluetooth", edit: "Edit", shareLoc: "Share live location", fall: "Fall detection",
    demoLoc: "Demo: tap map to move", map: "Around you", myId: "Digital tourist ID", logout: "Sign out",
    pending: "Waiting to send", pendingSub: "These messages are stored on your phone and sent automatically when the internet is back. Your band also relays SOS over the mesh.",
    sms: "Send by SMS instead", safe: "safe", alert: "alert",
    sosSent: "SOS sent", sosQueued: "No internet. SOS saved", sosQueuedSub: "It will send automatically when you are back online. Your band is relaying it over the mesh. You can also send an SMS.",
    stepSent: "Alert received by control room", stepAck: "Responder assigned", stepDone: "Resolved",
    cancel: "I'm safe, cancel alert", helpComing: "Help is on the way", resolved: "Your alert has been resolved",
    zoneIn: "You are in a risk zone", fallQ: "Are you OK?", fallSub: "A fall was detected. An alert will be sent automatically.",
    imOk: "I'm OK", sendNow: "Send help now", bandLinked: "Linked", bandNone: "Not linked", noBand: "No band linked",
    bandPrompt: "Enter your band ID (printed on the band)", connected: "Connected", advisory: "Advisory from authorities",
    police_s: "Police", hospital_s: "Hospital", locating: "Getting location…",
  },
  hi: {
    app: "सुरक्षा", online: "ऑनलाइन", offline: "ऑफ़लाइन",
    regTitle: "अपनी यात्रा पंजीकृत करें", regSub: "आपको आपके सुरक्षा बैंड से जुड़ी डिजिटल पर्यटक आईडी मिलेगी। पुलिस यह जानकारी केवल आपात स्थिति में देख सकती है।",
    fName: "पूरा नाम", fPhone: "फ़ोन", fNat: "राष्ट्रीयता", fDoc: "आधार / पासपोर्ट नं.", fBlood: "ब्लड ग्रुप", fBand: "बैंड आईडी",
    fMed: "चिकित्सा जानकारी", fEName: "आपातकालीन संपर्क", fEPhone: "संपर्क फ़ोन", fStart: "यात्रा प्रारंभ", fEnd: "यात्रा समाप्ति",
    fItin: "घूमने की जगहें", regBtn: "मेरी डिजिटल आईडी बनाएँ", haveId: "पहले से पंजीकृत हैं?", open: "खोलें",
    hello: "सुरक्षित रहें,", hold: "3 सेकंड दबाएँ", police: "आपातकाल", helpline: "पर्यटक हेल्पलाइन", family: "परिवार",
    band: "सुरक्षा बैंड", pair: "ब्लूटूथ से जोड़ें", edit: "बदलें", shareLoc: "लाइव लोकेशन साझा करें", fall: "गिरने की पहचान",
    demoLoc: "डेमो: मैप पर टैप करें", map: "आपके आसपास", myId: "डिजिटल पर्यटक आईडी", logout: "साइन आउट",
    pending: "भेजना बाकी है", pendingSub: "ये संदेश आपके फ़ोन में सुरक्षित हैं और इंटरनेट आते ही अपने आप भेजे जाएँगे। आपका बैंड भी मेश के ज़रिए SOS भेज रहा है।",
    sms: "SMS से भेजें", safe: "सुरक्षित", alert: "अलर्ट",
    sosSent: "SOS भेजा गया", sosQueued: "इंटरनेट नहीं है। SOS सहेजा गया", sosQueuedSub: "ऑनलाइन होते ही यह अपने आप भेजा जाएगा। आपका बैंड इसे मेश के ज़रिए भेज रहा है। आप SMS भी भेज सकते हैं।",
    stepSent: "कंट्रोल रूम को अलर्ट मिला", stepAck: "सहायता दल नियुक्त", stepDone: "समाधान हुआ",
    cancel: "मैं सुरक्षित हूँ, अलर्ट रद्द करें", helpComing: "मदद आ रही है", resolved: "आपका अलर्ट हल हो गया",
    zoneIn: "आप जोखिम क्षेत्र में हैं", fallQ: "क्या आप ठीक हैं?", fallSub: "गिरने का पता चला है। अलर्ट अपने आप भेजा जाएगा।",
    imOk: "मैं ठीक हूँ", sendNow: "अभी मदद भेजें", bandLinked: "जुड़ा है", bandNone: "नहीं जुड़ा", noBand: "कोई बैंड नहीं जुड़ा",
    bandPrompt: "अपनी बैंड आईडी डालें (बैंड पर छपी है)", connected: "कनेक्टेड", advisory: "प्रशासन की सूचना",
    police_s: "पुलिस", hospital_s: "अस्पताल", locating: "लोकेशन ढूँढ रहे हैं…",
  },
};

let LANG = (() => { try { return localStorage.getItem("suraksha.lang") || "en"; } catch { return "en"; } })();
const t = (k) => (STRINGS[LANG] && STRINGS[LANG][k]) || STRINGS.en[k] || k;

function applyI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  const btn = document.getElementById("langBtn");
  if (btn) btn.textContent = LANG === "en" ? "हिं" : "EN";
}
