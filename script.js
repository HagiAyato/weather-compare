const getCoords = (address) => {
    return new Promise((resolve) => {
        if (typeof window.getLatLng !== 'function') {
            resolve(null);
            return;
        }
        window.getLatLng(address, (latlng) => resolve(latlng));
    });
};

async function fetchWeather() {
    const input = document.getElementById('locationInput').value.trim();
    const resultDiv = document.getElementById('result');
    resultDiv.innerHTML = '<div class="text-center p-4 text-gray-500">気象データを解析中...</div>';

    try {
        let lat, lon;
        // 1. 座標取得の安定化
        if (input.includes(',')) {
            const parts = input.split(',');
            lat = parseFloat(parts[0]); lon = parseFloat(parts[1]);
        } else {
            const zipRes = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${input.replace(/-/g, '')}`);
            const zipData = await zipRes.json();
            // zipData.results が null の場合の処理
            if (!zipData.results || zipData.results.length === 0) throw new Error("郵便番号が見つかりません。");
            
            const addr = zipData.results[0];
            const addressText = `${addr.address1}${addr.address2}${addr.address3}`;
            const latlng = await getCoords(addressText);
            if (!latlng) throw new Error("住所から座標を特定できませんでした。");
            lat = latlng.lat; lon = latlng.lng;
        }

        // 2. 各モデル取得関数の強化版
        const fetchModel = async (modelName) => {
            const isJma = modelName === 'jma';
            const baseUrl = isJma ? 'https://api.open-meteo.com/v1/jma' : 'https://api.open-meteo.com/v1/forecast';
            
            // JMAの場合は降水量(precipitation_sum)を、他は確率を取得
            const dailyParams = isJma 
                ? 'temperature_2m_max,precipitation_sum' 
                : 'temperature_2m_max,precipitation_probability_max';

            const params = new URLSearchParams({
                latitude: lat,
                longitude: lon,
                daily: dailyParams,
                timezone: 'Asia/Tokyo'
            });
            if (!isJma) params.append('models', modelName);

            try {
                const res = await fetch(`${baseUrl}?${params.toString()}`);
                const d = await res.json();
                if (!d.daily) return null;

                const tempKey = Object.keys(d.daily).find(k => k.startsWith('temperature_2m_max'));
                // 確率か降水量、ある方のキーを探す
                const rainKey = Object.keys(d.daily).find(k => k.startsWith('precipitation_probability_max') || k.startsWith('precipitation_sum'));

                const tempValue = d.daily[tempKey]?.[1];
                const rainValue = d.daily[rainKey]?.[1];

                if (tempValue === undefined || tempValue === null) return null;

                return {
                    temp: tempValue.toFixed(1),
                    // JMAなら「mm」、他なら「%」を単位として付ける準備
                    rain: rainValue !== null ? rainValue : 0,
                    isJma: isJma
                };
            } catch (e) {
                return null;
            }
        };

        // 3. 全モデルを並列取得
        const [jma, ecmwf, gfs] = await Promise.all([
            fetchModel('jma'),
            fetchModel('ecmwf_ifs025'),
            fetchModel('gfs_seamless')
        ]);

        // 4. 結果表示
        resultDiv.innerHTML = `
            <div class="p-4 bg-white border rounded-lg shadow-sm">
                <h2 class="font-bold text-lg mb-4 text-center text-gray-700 underline decoration-blue-200">明日の予報比較</h2>
                <div class="grid grid-cols-3 gap-2">
                    ${renderCard("日本(JMA)", jma, "blue")}
                    ${renderCard("欧州(ECMWF)", ecmwf, "green")}
                    ${renderCard("米国(GFS)", gfs, "red")}
                </div>
                <div class="mt-4 p-2 bg-gray-50 rounded text-[9px] text-gray-400 text-center">
                    地点: ${lat.toFixed(2)}, ${lon.toFixed(2)} (Open-Meteo API)
                </div>
            </div>
        `;

    } catch (err) {
        resultDiv.innerHTML = `<p class="text-red-500 text-sm p-4 bg-red-50 border border-red-100 rounded text-center">⚠️ ${err.message}</p>`;
    }
}

function renderCard(label, data, color) {
    if (!data) {
        return `
            <div class="p-2 bg-gray-50 rounded border border-gray-100 text-center min-h-[110px] flex flex-col justify-center">
                <p class="text-[9px] font-bold text-gray-400">${label}</p>
                <p class="text-[10px] text-gray-300 mt-2">データなし</p>
            </div>
        `;
    }
    
    const colors = {
        blue:  { bg: 'bg-blue-50',  border: 'border-blue-100',  text: 'text-blue-800' },
        green: { bg: 'bg-green-50', border: 'border-green-100', text: 'text-green-800' },
        red:   { bg: 'bg-red-50',   border: 'border-red-100',   text: 'text-red-800' }
    };
    const c = colors[color];

    // 単位の切り替え
    const unit = data.isJma ? "mm" : "%";
    const rainLabel = data.isJma ? "予想降水量" : "降水確率";

    return `
        <div class="p-2 ${c.bg} rounded border ${c.border} text-center min-h-[110px] flex flex-col justify-between shadow-sm">
            <p class="text-[9px] font-bold ${c.text}">${label}</p>
            <div>
                <p class="text-xl font-mono font-bold leading-none">${data.temp}<span class="text-[10px] ml-0.5">°C</span></p>
            </div>
            <div class="pt-1 border-t border-white/60">
                <p class="text-[8px] text-gray-500 scale-90">${rainLabel}</p>
                <p class="text-sm font-bold text-blue-600">${data.rain}<span class="text-[8px] ml-0.5">${unit}</span></p>
            </div>
        </div>
    `;
}