/** WMO天気コードを絵文字に変換 */
function getWeatherIcon(code) {
    if (code === 0) return "☀️";
    if (code <= 3) return "🌤️";
    if (code <= 48) return "☁️";
    if (code <= 57) return "🌦️";
    if (code <= 67) return "☔";
    if (code <= 77) return "❄️";
    if (code <= 82) return "☔";
    if (code <= 86) return "❄️";
    if (code <= 99) return "⚡";
    return "❓";
}

/**
 * 住所→緯度経度座標変換(google Maps APIのジオコーディングメソッド)
 * @param {string} address 住所
 * @returns 座標
 */
const getCoords = (address) => {
    return new Promise((resolve) => {
        if (typeof window.getLatLng !== 'function') {
            resolve(null);
            return;
        }
        window.getLatLng(address, (latlng) => resolve(latlng));
    });
};

/**
 * 住所からjapanese-addresses API で座標を取得
 * @param {*} address1 都道府県
 * @param {*} address2 市区町村
 * @param {*} address3 町名
 * @returns 座標
 */
async function getCoordsFromJapaneseAddresses(address1, address2, address3) {
    const enc = (s) => encodeURIComponent(s);
    const url = `https://geolonia.github.io/japanese-addresses/api/ja/${enc(address1)}/${enc(address2)}.json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const towns = await res.json();
    if (!Array.isArray(towns) || towns.length === 0) return null;
    const townName = (address3 || '').trim();
    const match = townName
        ? towns.find(t => t.town && (t.town === townName || t.town.startsWith(townName)))
        : towns[0];
    if (match && typeof match.lat === 'number' && typeof match.lng === 'number') {
        return { lat: match.lat, lng: match.lng };
    }
    return null;
}

/**
 * 郵便番号→住所変換
 * 1. postcode.teraren.com
 * 2. フォールバックとしてzipcloud.ibsnet.co.jp
 * @param {string} zipcode 郵便番号
 * @returns 住所
 */
async function postToAddress(zipcode){
    let addr = null;
    const terRes = await fetch(`https://postcode.teraren.com/postcodes/${zipcode}.json`);
    if (terRes.ok) {
        const ter = await terRes.json();
        if (ter.prefecture && ter.city) {
            addr = {
                address1: ter.prefecture,
                address2: ter.city,
                address3: ter.suburb || ''
            };
        }
    }
    if (!addr) {
        const zipRes = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zipcode}`);
        const zipData = await zipRes.json();
        if (zipData.results && zipData.results.length > 0) {
            addr = zipData.results[0];
            addr.address3 = addr.address3 || '';
        }
    }
    if (!addr) throw new Error("郵便番号が見つかりません。");
    return addr
}

/**
 * メイン処理
 */
async function fetchWeather() {
    const input = document.getElementById('locationInput').value.trim();
    const resultDiv = document.getElementById('result');
    resultDiv.innerHTML = '<div class="text-center p-4 text-gray-500">気象データを解析中...</div>';

    const getDays = 8

    try {
        let lat, lon;
        const validCoord = (v) => typeof v === 'number' && !isNaN(v);
        // 1. 座標取得
        if (input.includes(',')) {
            // --- A. 緯度経度による直接指定 ---
            const parts = input.split(',');
            lat = parseFloat(parts[0]);
            lon = parseFloat(parts[1]);
            if (!validCoord(lat) || !validCoord(lon)) throw new Error("緯度・経度の形式が正しくありません。例: 35.6762,139.6503");
        } else if (/^\d{7}$|^\d{3}-\d{4}$/.test(input.replace(/\s/g, ''))) {
            // --- B. 郵便番号による検索 ---
            // 正規表現解説: ^\d{7}$ (数字7桁のみ) または ^\d{3}-\d{4}$ (3桁-4桁)
            console.log('Fetching from zipcode:', input);
            const zipcode = input.replace(/-/g, '').replace(/\s/g, '');
            addr = await postToAddress(zipcode);
            addressText = `${addr.address1}${addr.address2}${addr.address3}`;
            console.log('Address text:', addressText);
            let latlng = await getCoordsFromJapaneseAddresses(addr.address1, addr.address2, addr.address3);
            if (!latlng || !validCoord(latlng.lat) || !validCoord(latlng.lng)) {
                latlng = await getCoords(addressText);
            }
            if (!latlng || !validCoord(latlng.lat) || !validCoord(latlng.lng)) {
                throw new Error("住所から座標を特定できませんでした。");
            }
            lat = latlng.lat; lon = latlng.lng;
        } else if (input.length > 0) {
            // --- C. 直接住所や地名が入力された場合 ---
            console.log('Fetching from address text:', input);
            let latlng = null;

            // 1. まずは HeartRails Geo API を使って住所から座標を取得してみる
            // (これが一番安定して「都道府県・市区町村」レベルの座標を返します)
            try {
                const geoRes = await fetch(`https://geoapi.heartrails.com/api/json?method=suggest&matching=like&keyword=${encodeURIComponent(input)}`);
                const geoData = await geoRes.json();
                if (geoData.response && geoData.response.location && geoData.response.location.length > 0) {
                    const loc = geoData.response.location[0];
                    latlng = { lat: parseFloat(loc.y), lng: parseFloat(loc.x) };
                    console.log('Coords from HeartRails:', latlng);
                }
            } catch (e) {
                console.warn('HeartRails API failed, trying fallback...');
            }

            // 2. 解析できない、またはAPIで座標が取れなかった場合はエラー
            if (!latlng || !validCoord(latlng.lat) || !validCoord(latlng.lng)) {
                throw new Error("入力された場所が見つかりませんでした。");
            }
            lat = latlng.lat; lon = latlng.lng;
        } else {
            throw new Error("場所を入力してください（地名、郵便番号、または緯度経度）。");
        }
        console.log('Final coords:', lat, lon);

        // 2. 各モデル取得関数の強化版
        const fetchModel = async (modelName) => {
            const isJma = modelName === 'jma';
            const baseUrl = isJma ? 'https://api.open-meteo.com/v1/jma' : 'https://api.open-meteo.com/v1/forecast';

            // JMAの場合は降水量(precipitation_sum)を、他は確率を取得
            // ★ temperature_2m_min を追加
            const dailyParams = isJma
                ? 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum'
                : 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max';

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
                const maxKey = Object.keys(d.daily).find(k => k.startsWith('temperature_2m_max'));
                const minKey = Object.keys(d.daily).find(k => k.startsWith('temperature_2m_min'));
                const rainKey = Object.keys(d.daily).find(k => k.startsWith('precipitation_probability_max') || k.startsWith('precipitation_sum'));
                const codeKey = 'weather_code'; // 共通

                const days = Math.min(timeArr.length, getDays);
                const result = [];
                for (let i = 0; i < days; i++) {
                    const tMax = d.daily[maxKey]?.[i];
                    const tMin = d.daily[minKey]?.[i];
                    const r = d.daily[rainKey]?.[i] ?? 0;

                    result.push({
                        code: d.daily[codeKey]?.[i], // 天気コード
                        tempMax: (tMax !== undefined && tMax !== null) ? tMax.toFixed(1) : null,
                        tempMin: (tMin !== undefined && tMin !== null) ? tMin.toFixed(1) : null,
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
                const m = new Date(d).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' });
                return `<th class="px-2 py-1 text-[9px] whitespace-nowrap">${m}</th>`;
            }).join('');
            // first cell left empty but allow width to expand naturally
            return `<tr><th class="px-2 py-1"></th>${cells}</tr>`;
        };

        const renderDayCard = (data, color) => {
            if (!data || data.tempMax === null) {
                return `
                    <td class="w-24 p-2 bg-gray-50 rounded border border-gray-100 text-center">
                        <p class="text-[10px] text-gray-300">データなし</p>
                    </td>
                `;
            }

            const colors = {
                blue: { bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-800' },
                green: { bg: 'bg-green-50', border: 'border-green-100', text: 'text-green-800' },
                red: { bg: 'bg-red-50', border: 'border-red-100', text: 'text-red-800' }
            };
            // 雨の判定（JMAなら0.1mm以上、他は降水確率30%以上で水色に）
            const isRaining = data.isJma ? (data.rain > 0) : (data.rain >= 30);
            const bgClass = isRaining ? 'bg-cyan-100 border-cyan-200' : `${colors[color].bg} ${colors[color].border}`;
            const unit = data.isJma ? "mm" : "%";

            return `
                <td class="p-2 border ${bgClass} text-center min-w-[80px] transition-colors duration-300">
                    <div class="flex flex-col gap-1">
                        <div class="text-xl mb-1">${getWeatherIcon(data.code)}</div>
                        <div class="leading-tight">
                            <span class="text-sm font-bold text-red-500">${data.tempMax}</span>
                            <span class="text-[10px] text-gray-400">/</span>
                            <span class="text-sm font-bold text-blue-500">${data.tempMin}</span>
                            <span class="text-[8px] text-gray-400 ml-0.5">°C</span>
                        </div>
                        <div class="pt-1 border-t border-black/5">
                            <p class="text-[9px] font-bold text-blue-600">${data.rain}<span class="text-[7px] ml-0.5">${unit}</span></p>
                        </div>
                    </div>
                </td>
            `;
        };

        const renderRow = (label, modelData, color) => {
            const cells = (modelData || []).map(d => renderDayCard(d, color)).join('');
            return `
                <tr>
                    <td class="text-[10px] font-bold text-gray-600 py-2 pr-2 whitespace-nowrap text-left">
                        ${label}<br><span class="text-[8px] font-normal text-gray-400">最高/最低</span>
                    </td>
                    ${cells}
                </tr>
            `;
        };

        const mapUrl = `https://static-maps.yandex.ru/1.x/?lang=ja_JP&ll=${lon},${lat}&z=13&l=map&size=300,120`;
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
                <div class="mt-2 w-full max-w-[400px] h-[120px] mx-auto rounded-md border border-gray-200 overflow-hidden shadow-sm hover:opacity-90 transition-opacity">
                    <a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank">
                        <img src="${mapUrl}" alt="Location Map" class="w-full h-full object-cover">
                    </a>
                </div>
            </div>
        `;

    } catch (err) {
        resultDiv.innerHTML = `<p class="text-red-500 text-sm p-4 bg-red-50 border border-red-100 rounded text-center">⚠️ ${err.message}</p>`;
    }
}

