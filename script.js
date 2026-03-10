/** 利用可能な気象モデルの定義 */
const WEATHER_MODELS = {
    'jma': { name: '日本 (JMA)', color: 'blue' },
    'ecmwf_ifs025': { name: '欧州 (ECMWF)', color: 'green' },
    'gfs_seamless': { name: '米国 (GFS)', color: 'red' },
    'icon_seamless': { name: 'ドイツ (DWD/ICON)', color: 'orange' },
    'meteofrance_seamless': { name: '仏国 (METEOFRANCE)', color: 'purple' },
    'gem_seamless': { name: 'カナダ (CMC/GEM)', color: 'teal' }
};

/** 選択されている3つのモデルIDを保持 */
let selectedModels = ['jma', 'ecmwf_ifs025', 'gfs_seamless'];

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

/** WMO天気コードを日本語名に変換 */
function getWeatherName(code) {
    if (code === 0) return "快晴";
    if (code <= 3) return "晴れ";
    if (code <= 48) return "曇り";
    if (code <= 57) return "霧雨";
    if (code <= 67) return "雨";
    if (code <= 77) return "雪";
    if (code <= 82) return "激しい雨";
    if (code <= 86) return "猛吹雪";
    if (code <= 99) return "雷雨";
    return "不明";
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
async function postToAddress(zipcode) {
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

/** ドロップダウン変更時の処理 */
function handleModelChange(index, newModelId) {
    selectedModels[index] = newModelId;
    // 再描画（現在の入力内容で再取得）
    if (document.getElementById('locationInput').value.trim()) {
        fetchWeather();
    }
}

/**
 * メイン処理
 */
async function fetchWeather() {
    const input = document.getElementById('locationInput').value.trim();
    const resultDiv = document.getElementById('result');
    resultDiv.innerHTML = '<div class="text-center p-4 text-gray-500">気象データを解析中...</div>';

    const rowColors = ['blue', 'green', 'red']; // 行ごとの色固定
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
            const addr = await postToAddress(zipcode);
            const addressText = `${addr.address1}${addr.address2}${addr.address3}`;
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

        // 3. 選択された3つのモデルを並列取得
        const results = await Promise.all(selectedModels.map(id => fetchModel(id)));

        console.log('API Results:', { results });

        // 4. 結果表示（週間版）
        // 日付ヘッダーを取得。どれか一つのモデルで取得できれば十分。
        let dates = results.find(r => r?.times)?.times || [];

        const renderHeader = (dates) => {
            const cells = dates.map(d => {
                const dateObj = new Date(d);
                const m = dateObj.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
                const w = dateObj.toLocaleDateString('ja-JP', { weekday: 'short' });
                return `<th class="px-2 py-1 text-[10px] whitespace-nowrap">${m}<br><span class="text-[8px] opacity-60">${w}</span></th>`;
            }).join('');
            return `<tr><th class="w-24"></th>${cells}</tr>`;
        };

        const renderDayCard = (data, color) => {
            if (!data || data.tempMax === null) {
                return `<td class="p-2 bg-gray-50 border border-gray-100"><p class="text-[10px] text-gray-300">-</p></td>`;
            }

            const colors = {
                blue: { bg: 'bg-blue-50', border: 'border-blue-100' },
                green: { bg: 'bg-green-50', border: 'border-green-100' },
                red: { bg: 'bg-red-50', border: 'border-red-100' }
            };

            const isRaining = data.isJma ? (data.rain > 0) : (data.rain >= 30);
            const bgClass = isRaining ? 'bg-cyan-100 border-cyan-200' : `${colors[color].bg} ${colors[color].border}`;
            const unit = data.isJma ? "mm" : "%";

            return `
                <td class="p-2 border ${bgClass} text-center min-w-[80px] transition-colors duration-300">
                    <div class="flex flex-col gap-0.5">
                        <div class="text-xl">${getWeatherIcon(data.code)}</div>
                        <div class="text-[9px] font-bold text-gray-600 mb-1 leading-none">
                            ${getWeatherName(data.code)}
                        </div>
                        <div class="leading-tight">
                            <span class="text-sm font-bold text-red-500">${data.tempMax}</span>
                            <span class="text-[10px] text-gray-400">/</span>
                            <span class="text-sm font-bold text-blue-500">${data.tempMin}</span>
                            <span class="text-[8px] text-gray-400">°C</span>
                        </div>
                        <div class="pt-1 border-t border-black/5 mt-1">
                            <p class="text-[9px] font-bold text-blue-600">${data.rain}<span class="text-[7px] ml-0.5">${unit}</span></p>
                        </div>
                    </div>
                </td>
            `;
        };

        const renderModelSelect = (index) => {
            const options = Object.entries(WEATHER_MODELS).map(([id, info]) =>
                `<option value="${id}" ${selectedModels[index] === id ? 'selected' : ''}>${info.name}</option>`
            ).join('');
            return `
                <select onchange="handleModelChange(${index}, this.value)" 
                    class="text-[10px] font-bold border rounded bg-white/50 p-1 w-full focus:ring-0">
                    ${options}
                </select>
            `;
        };

        const renderRow = (modelIndex, data) => {
            const colorKey = rowColors[modelIndex];
            const cells = (data || []).map(d => renderDayCard(d, colorKey)).join('');
            return `
                <tr>
                    <td class="p-1 pr-2 min-w-[100px]">
                        ${renderModelSelect(modelIndex)}
                        <div class="text-[7px] text-gray-400 mt-0.5 text-left pl-1">最高 / 最低</div>
                    </td>
                    ${cells}
                </tr>
            `;
        };

        const mapUrl = `https://static-maps.yandex.ru/1.x/?lang=ja_JP&ll=${lon},${lat}&z=13&l=map&size=300,120`;

        // モデル選択用のHTML生成
        const modelSelectors = Object.entries(WEATHER_MODELS).map(([id, info]) => {
            const isChecked = selectedModels.includes(id) ? 'checked' : '';
            // 最大3つまでしか選べないように制御するためのクラス（JSで制御）
            return `
                <label class="inline-flex items-center space-x-1 bg-gray-50 px-2 py-1 rounded border text-[10px] cursor-pointer hover:bg-white transition-colors">
                    <input type="checkbox" value="${id}" ${isChecked} onchange="updateSelectedModels(this)" 
                        class="model-checkbox w-3 h-3 text-blue-600 focus:ring-0">
                    <span>${info.name}</span>
                </label>
            `;
        }).join('');

        resultDiv.innerHTML = `
            <div class="p-4 bg-white border rounded-lg shadow-sm">
                <h2 class="font-bold text-lg mb-4 text-center text-gray-700">週間予報モデル比較</h2>
                <div class="overflow-x-auto">
                    <table class="w-full table-auto border-separate border-spacing-px">
                        <thead class="bg-gray-100">${renderHeader(dates)}</thead>
                        <tbody>
                            ${results.map((data, i) => renderRow(i, data)).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="mt-4 p-2 bg-gray-50 rounded text-[9px] text-gray-400 text-center">
                    地点: ${lat.toFixed(4)}, ${lon.toFixed(4)}
                </div>
                <div class="mt-2 w-full max-w-[400px] h-[120px] mx-auto rounded-md border border-gray-200 overflow-hidden shadow-sm">
                    <a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank">
                        <img src="${mapUrl}" alt="Map" class="w-full h-full object-cover hover:opacity-90 transition-opacity">
                    </a>
                </div>
            </div>
        `;

    } catch (err) {
        resultDiv.innerHTML = `<p class="text-red-500 text-sm p-4 bg-red-50 border border-red-100 rounded text-center">⚠️ ${err.message}</p>`;
    }
}

