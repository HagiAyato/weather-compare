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

    const getDays = 8

    try {
        let lat, lon;
        // 1. 座標取得の安定化
        if (input.includes(',')) {
            const parts = input.split(',');
            lat = parseFloat(parts[0]); lon = parseFloat(parts[1]);
            console.log('Direct coords:', lat, lon);
        } else {
            console.log('Fetching from zipcode:', input);
            const zipRes = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${input.replace(/-/g, '')}`);
            const zipData = await zipRes.json();
            console.log('Zipcloud response:', zipData);
            // zipData.results が null の場合の処理
            if (!zipData.results || zipData.results.length === 0) throw new Error("郵便番号が見つかりません。");
            
            const addr = zipData.results[0];
            const addressText = `${addr.address1}${addr.address2}${addr.address3}`;
            console.log('Address text:', addressText);
            const latlng = await getCoords(addressText);
            console.log('getCoords result:', latlng);
            if (!latlng) throw new Error("住所から座標を特定できませんでした。");
            lat = latlng.lat; lon = latlng.lng;
            console.log('Final coords:', lat, lon);
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
                timezone: 'Asia/Tokyo',
                forecast_days: getDays
            });
            if (!isJma) params.append('models', modelName);

            try {
                const res = await fetch(`${baseUrl}?${params.toString()}`);
                const d = await res.json();
                if (!d.daily) return null;

                const timeArr = d.daily.time || [];
                const tempKey = Object.keys(d.daily).find(k => k.startsWith('temperature_2m_max'));
                const rainKey = Object.keys(d.daily).find(k => k.startsWith('precipitation_probability_max') || k.startsWith('precipitation_sum'));

                const days = Math.min(timeArr.length, getDays);
                const result = [];
                for (let i = 0; i < days; i++) {
                    const t = d.daily[tempKey]?.[i];
                    const r = d.daily[rainKey]?.[i] ?? 0;
                    // null や undefined のチェックを厳密に
                    const tempVal = (t !== undefined && t !== null) ? t.toFixed(1) : null;
                    result.push({
                        temp: tempVal,
                        rain: (r !== undefined && r !== null) ? r : 0,
                        isJma
                    });
                }

                // include time array for header generation
                result.times = timeArr.slice(0, days);
                return result;
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

        console.log('API Results:', { jma, ecmwf, gfs });

        // 4. 結果表示（週間版）
        // 日付ヘッダーを取得。どれか一つのモデルで取得できれば十分。
        let dates = [];
        for (const model of [jma, ecmwf, gfs]) {
            if (model && model.times) {
                dates = model.times;
                break;
            }
        }

        const renderHeader = (dates) => {
            const cells = dates.map(d => {
                const m = new Date(d).toLocaleDateString('ja-JP', {month:'numeric', day:'numeric'});
                return `<th class="px-2 py-1 text-[9px] whitespace-nowrap">${m}</th>`;
            }).join('');
            // first cell left empty but allow width to expand naturally
            return `<tr><th class="px-2 py-1"></th>${cells}</tr>`;
        };

        const renderDayCard = (data, color) => {
            if (!data || data.temp === null) {
                return `
                    <td class="w-24 p-2 bg-gray-50 rounded border border-gray-100 text-center min-h-[110px]">
                        <div class="flex flex-col justify-center h-full">
                            <p class="text-[9px] font-bold text-gray-400">-</p>
                            <p class="text-[10px] text-gray-300 mt-2">データなし</p>
                        </div>
                    </td>
                `;
            }
            const colors = {
                blue:  { bg: 'bg-blue-50',  border: 'border-blue-100',  text: 'text-blue-800' },
                green: { bg: 'bg-green-50', border: 'border-green-100', text: 'text-green-800' },
                red:   { bg: 'bg-red-50',   border: 'border-red-100',   text: 'text-red-800' }
            };
            const c = colors[color];
            const unit = data.isJma ? "mm" : "%";
            const rainLabel = data.isJma ? "予想降水量" : "降水確率";

            return `
                <td class="w-24 p-2 ${c.bg} rounded border ${c.border} text-center min-h-[110px] shadow-sm">
                    <div class="flex flex-col justify-between h-full">
                        <div>
                            <p class="text-xl font-mono font-bold leading-none">${data.temp}<span class="text-[10px] ml-0.5">°C</span></p>
                        </div>
                        <div class="pt-1 border-t border-white/60">
                            <p class="text-[8px] text-gray-500 scale-90">${rainLabel}</p>
                            <p class="text-sm font-bold text-blue-600">${data.rain}<span class="text-[8px] ml-0.5">${unit}</span></p>
                        </div>
                    </div>
                </td>
            `;
        };

        const renderRow = (label, modelData, color) => {
            const cells = (modelData || []).map(d => renderDayCard(d, color)).join('');
            // prevent label from wrapping vertically
            return `<tr><td class="text-[9px] font-bold text-gray-600 py-1 whitespace-nowrap">${label}</td>${cells}</tr>`;
        };

        resultDiv.innerHTML = `
            <div class="p-4 bg-white border rounded-lg shadow-sm overflow-x-auto">
                <h2 class="font-bold text-lg mb-4 text-center text-gray-700 underline decoration-blue-200">週間予報比較</h2>
                <table class="w-full table-auto text-center">
                    <thead class="bg-gray-100">${renderHeader(dates)}</thead>
                    <tbody>
                        ${renderRow('日本(JMA)', jma, 'blue')}
                        ${renderRow('欧州(ECMWF)', ecmwf, 'green')}
                        ${renderRow('米国(GFS)', gfs, 'red')}
                    </tbody>
                </table>
                <div class="mt-4 p-2 bg-gray-50 rounded text-[9px] text-gray-400 text-center">
                    地点: ${lat.toFixed(2)}, ${lon.toFixed(2)} (Open-Meteo API)
                </div>
            </div>
        `;

    } catch (err) {
        resultDiv.innerHTML = `<p class="text-red-500 text-sm p-4 bg-red-50 border border-red-100 rounded text-center">⚠️ ${err.message}</p>`;
    }
}

