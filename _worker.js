import { connect } from 'cloudflare:sockets';

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    // Mengambil teks setelah tanda miring "/" (misal: "176.97.66.175:443")
    let pathParam = url.pathname.substring(1).trim(); 

    // =========================================================================
    // SINKRONISASI FITUR 1: HANDLER GET UNTUK SINGLE CHECK DARI WEB UI KAMU
    // =========================================================================
    if (request.method === "GET" && pathParam.length > 0 && pathParam.includes(":")) {
      const hasilSingle = await prosesPinger([pathParam], true);
      // Sinkronisasi: Kirim objek tunggal {} sesuai kebutuhan ".then((data) => data[0] : data)" di HTML
      return new Response(JSON.stringify(hasilSingle[0]), { headers: corsHeaders });
    }

    // =========================================================================
    // FITUR 2: HANDLE MASSAL POST REQUEST DARI HALAMAN INPUT DASHBOARD WORKER
    // =========================================================================
    if (request.method === "POST") {
      try {
        const body = await request.json();
        let daftarIp = body.ips;
        
        if (!daftarIp || !Array.isArray(daftarIp)) {
          return new Response(JSON.stringify({ error: "Format harus array 'ips'" }), { status: 400, headers: corsHeaders });
        }

        daftarIp = daftarIp.map(ip => ip.replace(/[\r\n\t]/g, "").trim()).filter(ip => ip.length > 0);

        const hasilCheck = await prosesPinger(daftarIp, false);
        return new Response(JSON.stringify({ results: hasilCheck }), { headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Gagal memproses" }), { status: 400, headers: corsHeaders });
      }
    }

    // =========================================================================
    // FRONTEND DASHBOARD WORKER
    // =========================================================================
    return new Response(`
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><title>Benxx Proxy Checker Backend</title><script src="https://cdn.tailwindcss.com"></script></head>
    <body class="bg-gray-900 text-gray-100 p-8 flex items-center justify-center min-h-screen">
        <div class="max-w-md w-full bg-gray-800 p-6 rounded-xl shadow-xl border border-gray-700 text-center">
            <h1 class="text-xl font-bold text-purple-400 mb-2">Benxx Proxy Checker Backend</h1>
            <p class="text-sm text-gray-400">API Aktif & Sinkron dengan Web UI Utama.<br>Format teks GitHub: <code class="bg-gray-950 px-1 py-0.5 rounded text-amber-400 text-xs">IP,PORT,NEGARA,ISP</code></p>
        </div>
    </body>
    </html>
    `, { headers: { "Content-Type": "text/html" } });
  }
};

// =========================================================================
// SINKRONISASI ENGINE UTAMA: MEMAKSA OUTPUT "proxyip: true/false"
// =========================================================================
async function prosesPinger(daftarIp, isStrictSingle) {
  const hasilCheck = [];

  await Promise.all(daftarIp.map(async (barisRaw) => {
    let ipSaja = "";
    let portSaja = 443;
    
    let countryCode = "UN";
    let isp = "Unknown ISP";
    let country = "Unknown";

    // Parsing format data berdasarkan jenis request
    if (!isStrictSingle && barisRaw.includes(",")) {
      // Pembacaan format GitHub: 176.97.66.175,443,AE,3nt solutions LLP
      const bagianKoma = barisRaw.split(",");
      if (bagianKoma.length >= 2) {
        ipSaja = bagianKoma[0].trim();
        portSaja = parseInt(bagianKoma[1].trim()) || 443;
      }
      if (bagianKoma.length >= 3) countryCode = bagianKoma[2].trim();
      if (bagianKoma.length >= 4) isp = bagianKoma[3].trim();
      country = countryCode; 
    } else {
      // Pembacaan format GET URL Web UI: 176.97.66.175:443
      const barisBersih = barisRaw.replace("-", ":").trim();
      const bagianTitikDua = barisBersih.split(":");
      ipSaja = bagianTitikDua[0].trim();
      portSaja = parseInt(bagianTitikDua[1]) || 443;
    }

    if (!ipSaja) return;
    const ipPortGabung = `${ipSaja}:${portSaja}`;

    let status = "DEAD";
    let latency = "0ms";
    const startTime = Date.now();

    // Test TCP socket koneksi nyata
    try {
      const socket = connect({ hostname: ipSaja, port: portSaja });
      await Promise.race([
        socket.opened,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 2500))
      ]);
      status = "LIVE";
      latency = `${Date.now() - startTime}ms`;
      socket.close();
    } catch (e) {
      status = "DEAD";
      latency = "0ms";
    }

    if (status === "LIVE") {
      try {
        const geoRes = await fetch(`http://ip-api.com/json/${ipSaja}?fields=status,country,countryCode,isp`);
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData.status === "success") {
            isp = geoData.isp || isp;
            country = geoData.country || country;
            countryCode = geoData.countryCode || countryCode;
          }
        }
      } catch (err) {}
    }

    // DI SINI SINKRONISASINYA: Kita tambahkan 'proxyip' agar dibaca lancar oleh HTML-mu
    hasilCheck.push({
      ip: ipPortGabung,
      status: status,
      proxyip: status === "LIVE" ? true : false, // <--- Menyuapi "proxyData.proxyip === true" di UI kamu
      latency: latency,
      provider: isp,
      country: country,
      country_code: countryCode
    });
  }));

  return hasilCheck;
}
