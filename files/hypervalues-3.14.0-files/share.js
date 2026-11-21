/*
 * Share links: your answers packed into a short code that fits in a URL hash, and back.
 *   HVShare.encode(answers) -> "AQ..." (url-safe base64)
 *   HVShare.decode(code)    -> answers ({ category: [{ value, agree }] }) or null if the code is not valid
 *   HVShare.link(page, answers) -> absolute link such as ".../shared.html#r=AQ..."
 *   HVShare.codeFromText(text)  -> the code inside a pasted link or a bare code, or null
 * Needs data.js and scoring.js (HV.categoryOf) to be loaded first.
 *
 * Format: 1 version byte, then 4 bytes per value: a 24-bit hash of the value's id (so the code stays valid when
 * values are added or reordered in data.js) and the agreement in hundredths + 100 (0..200).
 * tools/check_share.js fails if two values ever get the same hash.
 */
const HVShare = (function () {
    const VERSION = 1;

    // FNV-1a, cut to 24 bits
    function hashOf(id) {
        let h = 0x811c9dc5;
        for (let i = 0; i < id.length; i++) {
            h ^= id.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return (h >>> 0) & 0xffffff;
    }

    const byHash = {};
    Object.keys(HV.categoryOf).forEach(id => {
        const h = hashOf(id);
        if (byHash[h] === undefined) byHash[h] = id;
    });

    function toBase64Url(bytes) {
        let binary = '';
        bytes.forEach(b => { binary += String.fromCharCode(b); });
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function fromBase64Url(text) {
        const padded = text.replace(/-/g, '+').replace(/_/g, '/');
        const binary = atob(padded + '='.repeat((4 - padded.length % 4) % 4));
        return Uint8Array.from(binary, ch => ch.charCodeAt(0));
    }

    function encode(answers) {
        const bytes = [VERSION];
        Object.keys(answers || {}).forEach(category => {
            (answers[category] || []).forEach(item => {
                if (!(item.value in HV.categoryOf)) return;
                const level = Math.max(-1, Math.min(1, Number(item.agree) || 0));
                const h = hashOf(item.value);
                bytes.push((h >> 16) & 255, (h >> 8) & 255, h & 255, Math.round(level * 100) + 100);
            });
        });
        return toBase64Url(bytes);
    }

    function decode(code) {
        let bytes;
        try { bytes = fromBase64Url(String(code || '').trim()); } catch (e) { return null; }
        if (bytes.length < 5 || bytes[0] !== VERSION || (bytes.length - 1) % 4 !== 0) return null;
        const answers = {};
        const seen = {};
        for (let i = 1; i < bytes.length; i += 4) {
            const h = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
            const raw = bytes[i + 3];
            const id = byHash[h];
            if (!id || raw > 200 || seen[id]) continue;          // unknown value (newer or older data) or repeated: skipped
            seen[id] = true;
            const category = HV.categoryOf[id];
            (answers[category] = answers[category] || []).push({ value: id, agree: (raw - 100) / 100 });
        }
        return Object.keys(answers).length ? answers : null;
    }

    function link(page, answers) {
        const base = location.href.split('#')[0].replace(/[^/]*$/, '');
        return base + page + '#r=' + encode(answers);
    }

    // A pasted link (...#r=CODE, ...#a=CODE, ...#b=CODE) or just the code
    function codeFromText(text) {
        const value = String(text || '').trim();
        if (!value) return null;
        const match = value.match(/[#&?](?:r|a|b)=([A-Za-z0-9_-]+)/);
        const code = match ? match[1] : value;
        return /^[A-Za-z0-9_-]+$/.test(code) && decode(code) ? code : null;
    }

    return { encode, decode, link, codeFromText, hashOf };
})();
