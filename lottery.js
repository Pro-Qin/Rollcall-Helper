// ============ 全局状态 ============
let items = [];
let pool = [];
let history = [];
let points = 100;
let soundOn = true;
let soundVolume = 0.5; // 0~1
let slotDebugMode = false;
let slotDebugD1 = 0; // 第一位（0-2）
let slotDebugD2 = 0; // 第二位（0-9）
let selectedSound = 'meow';
let audioCtx = null;
let uploadedEmojiData = null;
let spinning = false;
let slotTriggerTimer1 = null;
let slotTriggerTimer2 = null;
let rot = 0;
let mergedData = [];
let wheelCache = null;
let lastPoolSig = '';
let currentPctMap = new Map(); // 每个奖项当前的动态pct（抽奖后衰减，不保存）
let decayEnabled = true; // 衰减开关，可在配置面板切换

// 衰减率函数：pct越大衰减越接近5%，pct越小衰减越接近0.1%
function getDecayRate(pct) {
    const minPct = 1, maxPct = 100;
    const minRate = 0.001;  // 0.1%
    const maxRate = 0.05;   // 5%
    if (pct <= minPct) return minRate;
    if (pct >= maxPct) return maxRate;
    const t = (pct - minPct) / (maxPct - minPct);
    return minRate + t * (maxRate - minRate);
}

function decayPct(currentPct) {
    const rate = getDecayRate(currentPct);
    const newPct = currentPct * (1 - rate);
    return Math.max(0.1, newPct); // 最小值0.1，不会到0
}

const DEFAULT_ITEMS = [
    { id: 1, name: '积分清零', type: 'negative', pct: 10, easterEgg: '', easterSound: 'sad' },
    { id: 2, name: '积分翻倍', type: 'positive', pct: 10, easterEgg: '', easterSound: 'tada' },
    { id: 3, name: '积分增长类', type: 'positive', pct: 15, easterEgg: '', easterSound: 'drum' },
    { id: 4, name: '无事发生', type: 'neutral', pct: 20, easterEgg: '', easterSound: 'none' },
    { id: 5, name: '积分交换', type: 'special', pct: 10, easterEgg: '', easterSound: 'drum' },
    { id: 6, name: '积分一天翻倍卡', type: 'special', pct: 10, easterEgg: '', easterSound: 'tada' },
    { id: 7, name: '奶茶一杯~', type: 'positive', pct: 10, easterEgg: '', easterSound: 'meow' },
    { id: 8, name: '再来一次！', type: 'positive', pct: 10, easterEgg: '', easterSound: 'tada' },
    { id: 9, name: '作业', type: 'negative', pct: 5, easterEgg: '', easterSound: 'sad' },
    { id: 10, name: '积分减少类', type: 'negative', pct: 15, easterEgg: '', easterSound: 'sad' }
];

// 按百分比将奖项展开为奖池（始终精确为100个，几率严格=pct%）
// 使用最大余额法（Largest Remainder Method）处理舍入
// 注意：使用 currentPctMap 中的动态 pct（抽奖后会衰减），不保存
function expandByPct(items) {
    // 用 currentPctMap 中的动态值覆盖 pct
    const itemsWithPct = items.map(it => ({
        ...it,
        pct: currentPctMap.get(it.id) ?? (it.pct || 1)
    }));

    const total = itemsWithPct.reduce((a, x) => a + (x.pct || 0), 0);
    if (total === 0) return [];

    const pool = [];
    const shares = itemsWithPct.map(it => ({
        item: it,
        raw: (it.pct || 0) / total * 100
    }));

    // 第一部分：每个奖项分配 floor(raw) 个
    shares.forEach(s => {
        const intPart = Math.floor(s.raw);
        for (let i = 0; i < intPart; i++) pool.push({ ...s.item });
    });

    // 剩余名额按小数部分从大到小分配
    const remainder = shares.map(s => ({
        item: s.item,
        frac: s.raw - Math.floor(s.raw)
    })).sort((a, b) => b.frac - a.frac);

    let remaining = 100 - pool.length;
    for (let i = 0; i < remaining && i < remainder.length; i++) {
        pool.push({ ...remainder[i].item });
    }

    // 防御性处理（理论上不会进入）
    while (pool.length < 100) pool.push({ ...itemsWithPct[0] });
    while (pool.length > 100) pool.pop();

    return pool;
}

const ALL_COLORS = [
    '#6366f1','#8b5cf6','#ec4899','#ef4444',
    '#f97316','#facc15','#22c55e','#14b8a6',
    '#06b6d4','#3b82f6','#a78bfa','#f472b6'
];

// ============ 初始化 ============
window.addEventListener('load', () => {
    loadAll();
    drawWheel();
    renderItems();
    renderHistory();
    renderSettings();
    updateUI();
    initBg();
    startWheelLoop();
    document.body.addEventListener('click', initAudio, { once:true });
});

function $(id) { return document.getElementById(id); }

function initAudio() {
    if (!audioCtx) audioCtx = new (AudioContext||webkitAudioContext)();
    if (audioCtx.state==='suspended') audioCtx.resume();
}

function loadAll() {
    try { items = JSON.parse(localStorage.getItem('l_items')||'[]'); } catch(e){}
    // 没有数据时自动加载默认奖项
    if (!items || items.length === 0) {
        items = DEFAULT_ITEMS.map(it => ({ ...it }));
        save('items', items);
    }
    // pool 不再从 localStorage 加载，改为动态构建
    pool = [];
    try { history = JSON.parse(localStorage.getItem('l_history')||'[]'); } catch(e){}
    try { selectedSound = localStorage.getItem('l_sound')||'meow'; } catch(e){}
    try { soundOn = localStorage.getItem('l_soundOn')!=='false'; } catch(e){}
    try { soundVolume = parseFloat(localStorage.getItem('l_volume'))||0.5; } catch(e){}
    try { slotDebugMode = localStorage.getItem('l_slot_debug')==='true'; } catch(e){}
    try { slotDebugD1 = parseInt(localStorage.getItem('l_slot_d1'))||0; } catch(e){}
    try { slotDebugD2 = parseInt(localStorage.getItem('l_slot_d2'))||0; } catch(e){}
    // 加载衰减开关（默认开启）
    try { decayEnabled = localStorage.getItem('l_decay') !== 'false'; } catch(e){}
    // 初始化 currentPctMap：从 items 读取每个奖项的原始 pct
    resetCurrentPctMap();
    rebuildPool();
}

// 重置 currentPctMap 为 items 中的原始 pct 值
function resetCurrentPctMap() {
    currentPctMap.clear();
    items.forEach(it => {
        currentPctMap.set(it.id, it.pct || 1);
    });
}

function save(k,v) { localStorage.setItem('l_'+k,JSON.stringify(v)); }

function rebuildPool() {
    pool = expandByPct(items);
    wheelCache = null;
}

function resetPool() {
    if (!confirm('确定重置奖池？所有奖项名额将恢复。')) return;
    // 重置 currentPctMap 为 items 中的原始 pct
    currentPctMap.clear();
    items.forEach(it => {
        currentPctMap.set(it.id, it.pct || 1);
    });
    rebuildPool();
    drawWheel();
    renderItems();
    updateUI();
    showToast('✅ 奖池已重置！');
}

// ============ 绘制转盘（合并重复项 + 离屏缓存 + 减少阴影）============
function getPoolSignature() {
    return pool.map(p => p.id).join(',');
}

// 特殊奖项发光动画时间
let specialGlowTime = 0;

function buildWheelCache(sz, dpr) {
    const cacheCv = document.createElement('canvas');
    cacheCv.width = sz * dpr;
    cacheCv.height = sz * dpr;
    const cacheCtx = cacheCv.getContext('2d');
    cacheCtx.scale(dpr, dpr);

    const cx = sz / 2, cy = sz / 2, r = sz / 2 - 4;

    if (pool.length === 0) {
        cacheCtx.beginPath(); cacheCtx.arc(cx, cy, r, 0, Math.PI * 2);
        cacheCtx.fillStyle = 'rgba(99,102,241,0.08)'; cacheCtx.fill();
        cacheCtx.strokeStyle = 'rgba(99,102,241,0.3)'; cacheCtx.lineWidth = 2; cacheCtx.stroke();
        cacheCtx.fillStyle = 'rgba(148,163,184,0.7)'; cacheCtx.font = 'bold 17px system-ui';
        cacheCtx.textAlign = 'center'; cacheCtx.textBaseline = 'middle';
        cacheCtx.fillText('请先配置奖项', cx, cy);
        mergedData = [];
        return cacheCv;
    }

    // 合并相同id的项目
    const merged = [];
    const itemMap = new Map();
    pool.forEach((it) => {
        if (!itemMap.has(it.id)) {
            itemMap.set(it.id, { ...it, count: 0 });
            merged.push(itemMap.get(it.id));
        }
        itemMap.get(it.id).count++;
    });
    mergedData = merged;

    const totalCount = pool.length;
    let currentAngle = 0;

    merged.forEach((it, idx) => {
        const sliceAngle = (Math.PI * 2 * it.count) / totalCount;
        const sa = currentAngle;
        const ea = sa + sliceAngle;

        cacheCtx.beginPath();
        cacheCtx.moveTo(cx, cy);
        cacheCtx.arc(cx, cy, r, sa, ea);
        cacheCtx.closePath();
        cacheCtx.fillStyle = ALL_COLORS[idx % ALL_COLORS.length];
        cacheCtx.fill();
        cacheCtx.strokeStyle = 'rgba(255,255,255,0.25)'; cacheCtx.lineWidth = 1.5; cacheCtx.stroke();

        // 文字 - 沿径向排列，左半边翻转使其可读
        const ma = sa + sliceAngle / 2;
        const na = ((ma % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const fontSize = Math.max(10, Math.round(r * 0.065));
        const dist = r * 0.55;
        const displayName = it.name.length > 7 ? it.name.substring(0, 7) + '..' : it.name;

        cacheCtx.save();
        cacheCtx.translate(cx, cy);  // 移到圆心
        cacheCtx.rotate(ma);          // 旋转到扇形中间方向（x轴指向扇形中间）
        cacheCtx.textAlign = 'center';
        cacheCtx.textBaseline = 'middle';
        cacheCtx.fillStyle = '#ffffff';
        cacheCtx.font = `bold ${fontSize}px system-ui`;
        cacheCtx.shadowColor = 'rgba(0,0,0,0.5)';
        cacheCtx.shadowBlur = 2;

        if (na > Math.PI / 2 && na < Math.PI * 3 / 2) {
            // 左半边：先移到径向外位置，再翻转180°使文字可读（从外向圆心读）
            cacheCtx.translate(dist, 0);   // 沿x轴正方向（ma方向）移dist
            cacheCtx.rotate(Math.PI);       // 翻转180°，文字变成从外向内读
            cacheCtx.fillText(displayName, 0, 0);
        } else {
            // 右半边：沿径向从圆心向外读
            cacheCtx.translate(dist, 0);
            cacheCtx.fillText(displayName, 0, 0);
        }
        cacheCtx.restore();

        currentAngle += sliceAngle;
    });

    return cacheCv;
}

let wheelSz = 0;
let wheelDpr = 1;

function drawWheel() {
    const cv = $('wheelCanvas');
    const ctx = cv.getContext('2d');
    const sz = Math.min(window.innerWidth * 0.38, 420);
    const dpr = devicePixelRatio || 1;

    // 只在尺寸变化时才 resize canvas（避免频繁 resize 导致闪烁）
    if (wheelSz !== sz || wheelDpr !== dpr) {
        wheelSz = sz;
        wheelDpr = dpr;
        cv.width = sz * dpr; cv.height = sz * dpr;
        cv.style.width = sz + 'px'; cv.style.height = sz + 'px';
        wheelCache = null; // 尺寸变了，缓存失效
    }

    const cx = sz / 2, cy = sz / 2, r = sz / 2 - 4;

    // 检查缓存
    const poolSig = getPoolSignature();
    if (!wheelCache || lastPoolSig !== poolSig) {
        wheelCache = buildWheelCache(sz, dpr);
        lastPoolSig = poolSig;
    }

    // 每帧重置变换，再重新 scale
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sz, sz);

    if (wheelCache) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot * Math.PI / 180);
        ctx.translate(-cx, -cy);
        ctx.drawImage(wheelCache, 0, 0, sz, sz);

        // 特殊奖项扇形：仅外边缘轮廓脉冲发光（内部不发光）
        if (mergedData.length > 0) {
            specialGlowTime += 0.035;
            const pulse = 0.5 + 0.5 * Math.sin(specialGlowTime);
            const glowAlpha = 0.18 + 0.22 * pulse;
            const glowWidth = 3 + 2 * pulse;
            const shadowBlurVal = 12 + 8 * pulse;

            const totalCount = pool.length;
            let currentAngle = 0;
            mergedData.forEach((it) => {
                const sliceAngle = (Math.PI * 2 * it.count) / totalCount;
                const sa = currentAngle;
                const ea = sa + sliceAngle;

                if (it.type === 'special') {
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(cx, cy);
                    ctx.lineTo(cx + r * Math.cos(sa), cy + r * Math.sin(sa));
                    ctx.arc(cx, cy, r, sa, ea);
                    ctx.lineTo(cx, cy);
                    ctx.closePath();

                    ctx.shadowColor = `rgba(245, 200, 60, ${glowAlpha * 0.9})`;
                    ctx.shadowBlur = shadowBlurVal;
                    ctx.strokeStyle = `rgba(255, 235, 100, ${glowAlpha * 1.4})`;
                    ctx.lineWidth = glowWidth;
                    ctx.stroke();
                    ctx.restore();
                }
                currentAngle += sliceAngle;
            });
        }

        ctx.restore();
    }

    // 中心圆
    ctx.beginPath(); ctx.arc(cx, cy, 32, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15,23,42,0.95)'; ctx.fill();
    ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 24px system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🎯', cx, cy);
}

// ============ 抽奖 ============
function doSpin() {
    if(spinning || pool.length<2){ if(pool.length<2)alert('至少需要2个奖项！'); return;}

    // 清除可能残留的老虎机定时器
    if (slotTriggerTimer1) { clearTimeout(slotTriggerTimer1); slotTriggerTimer1 = null; }
    if (slotTriggerTimer2) { clearTimeout(slotTriggerTimer2); slotTriggerTimer2 = null; }

    initAudio(); spinning=true;

    const spins = 5+Math.random()*4;
    const final = Math.random()*360;
    const totalRot = rot + spins*360 + final;
    const dur = 3000+Math.random()*1500;
    let st=null, lastTick=0;

    function anim(t){
        if(!st)st=t;
        const p=Math.min((t-st)/dur,1);
        const eo = 1-Math.pow(1-p,3);
        rot = totalRot*eo;
        drawWheel();
        if(soundOn&&p<0.88){
            const tk=Math.floor(rot/12);
            if(tk !== lastTick){lastTick=tk; playTick();}
        }
        if(p<1) requestAnimationFrame(anim);
        else {
            spinning=false;
            // 根据最终角度找到合并项
            const nr = rot % 360;
            const normalizedAngle = (360 - nr + 270) % 360;

            let accumulatedAngle = 0;
            const totalPool = pool.length;
            let resultItem = null;
            for(let i=0; i<mergedData.length; i++){
                const sliceAngle = (360 * mergedData[i].count) / totalPool;
                accumulatedAngle += sliceAngle;
                if(normalizedAngle <= accumulatedAngle){
                    resultItem = mergedData[i];
                    break;
                }
            }
            if(!resultItem && mergedData.length>0) resultItem = mergedData[mergedData.length-1];

            if(resultItem){
                showResult(resultItem);
                wheelCache = null;

                if (decayEnabled) {
                    // 动态衰减：更新 currentPctMap，不保存，重新构建奖池
                    const currentPct = currentPctMap.get(resultItem.id) ?? (resultItem.pct || 1);
                    const newPct = decayPct(currentPct);
                    currentPctMap.set(resultItem.id, newPct);
                }
                rebuildPool();
            }

            if(pool.length===0){
                setTimeout(()=>{ rebuildPool(); drawWheel(); renderItems(); updateUI(); },500);
            }
        }
    }
    requestAnimationFrame(anim);
}

function showResult(item) {
    initAudio();
    const ov=$('resultOverlay');
    const img=$('resImg'), txt=$('resText'), sub=$('resSub');

    if(item.easterEgg){
        img.src=item.easterEgg; img.style.display='';
        img.classList.remove('emoji-exit');
        img.classList.add('emoji-anim');
    } else {
        img.style.display='none';
        img.classList.remove('emoji-anim');
        img.classList.remove('emoji-exit');
    }

    txt.textContent=item.name;
    txt.className='res-text '+item.type;

    const msgs={
        positive:'🎉 太棒了！获得奖励！',
        negative:'💀 哎呀...接受惩罚吧',
        neutral:'😐 无事发生...',
        special:'⭐ 恭喜！获得特殊奖励！'
    };
    sub.textContent=msgs[item.type]||'';

    ov.classList.add('show');

    setTimeout(()=>{
        if(!soundOn)return;
        playSound(item.easterSound||(item.type==='negative'?'sad':selectedSound));
    },250);

    addHist(item);

    // 积分增长类 / 积分减少类 → 更快弹出老虎机
    if (item.name === '积分增长类' || item.name === '积分减少类') {
        const isPositive = item.name === '积分增长类';
        // 1秒后启动emoji退出动画
        slotTriggerTimer1 = setTimeout(() => {
            img.classList.add('emoji-exit');
        }, 1000);
        // 1.5秒后关闭结果弹窗并展示老虎机
        slotTriggerTimer2 = setTimeout(() => {
            ov.classList.remove('show');
            img.classList.remove('emoji-anim');
            img.classList.remove('emoji-exit');
            showSlot(isPositive);
        }, 1500);
    }

    // 贬类（非积分减少类）→ 显示嘲笑表情包 + 自定义动画
    if (item.type === 'negative' && item.name !== '积分减少类') {
        showLaughAtEmoji();
    }
}

function closeResult(){ $('resultOverlay').classList.remove('show'); updateUI(); }

// ============ 音效 ============
function playTick(){
    if(!audioCtx)return;
    try{
        const vol=Math.max(0.001, soundVolume*0.06);
        const o=audioCtx.createOscillator(),g=audioCtx.createGain();
        o.connect(g); g.connect(audioCtx.destination);
        o.type='sine'; o.frequency.value=1000;
        g.gain.setValueAtTime(vol,audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+0.07);
        o.start(); o.stop(audioCtx.currentTime+0.07);
    }catch(e){}
}

function playSound(type){
    if(!audioCtx || type==='none') return;
    const t=audioCtx.currentTime;
    const v=soundVolume;
    switch(type){
        case'meow':
            const m=audioCtx.createOscillator(),mg=audioCtx.createGain();
            m.connect(mg); mg.connect(audioCtx.destination);
            m.frequency.setValueAtTime(800,t); m.frequency.exponentialRampToValueAtTime(1200,t+0.1);
            m.frequency.exponentialRampToValueAtTime(550,t+0.3);
            mg.gain.setValueAtTime(Math.max(0.001,v*0.25),t); mg.gain.exponentialRampToValueAtTime(0.01,t+0.4);
            m.start(t); m.stop(t+0.4);
            break;
        case'tada':[523.25,659.25,783.99,1046.50].forEach((f,i)=>{
                const o=audioCtx.createOscillator(),g=audioCtx.createGain();
                o.connect(g); g.connect(audioCtx.destination);
                o.frequency.value=f; g.gain.setValueAtTime(0.18,t+i*0.1);
                g.gain.exponentialRampToValueAtTime(0.001,t+i*0.1+0.3);
                o.start(t+i*0.1); o.stop(t+i*0.1+0.3);
            }); break;
        case'sad':{
            const s=audioCtx.createOscillator(),sg=audioCtx.createGain();
            s.connect(sg); sg.connect(audioCtx.destination);
            s.frequency.setValueAtTime(400,t); s.frequency.exponentialRampToValueAtTime(200,t+0.5);
            sg.gain.setValueAtTime(Math.max(0.001,v*0.25),t); sg.gain.exponentialRampToValueAtTime(0.01,t+0.6);
            s.start(t); s.stop(t+0.6);
            break;
        }
        case'drum':
            for(let i=0;i<3;i++){
                const d=audioCtx.createOscillator(),dg=audioCtx.createGain();
                d.connect(dg); dg.connect(audioCtx.destination);
                d.frequency.setValueAtTime(150,t+i*0.2); d.frequency.exponentialRampToValueAtTime(50,t+i*0.2+0.15);
                dg.gain.setValueAtTime(Math.max(0.001,v*0.35),t+i*0.2); dg.gain.exponentialRampToValueAtTime(0.01,t+i*0.2+0.2);
                d.start(t+i*0.2); d.stop(t+i*0.2+0.2);
            }
            break;
    }
}

// ============ CRUD ============
function addItem(type){
    const n=$('inpName').value.trim();
    if(!n){alert('请输入名称');return;}
    const p=parseInt($('inpPct').value)||1;
    const item={
        id:Date.now(),
        name:n,
        type:type,
        pct:p,
        easterEgg:uploadedEmojiData||'',
        easterSound:$('inpSound').value
    };
    items.push(item);
    currentPctMap.set(item.id, p); // 同步 currentPctMap
    save('items',items);
    rebuildPool();
    closeSlide('newItemPanel');
    renderItems(); renderSettings(); drawWheel(); updateUI();
    showToast('✅ 奖项已添加！');
}

function deleteItem(id){
    items=items.filter(x=>String(x.id)!==String(id));
    currentPctMap.delete(id); // 同步 currentPctMap
    save('items',items); rebuildPool();
    renderItems(); renderSettings(); drawWheel(); updateUI();
    showToast('🗑️ 已删除');
}

// ============ 编辑奖项 ============
function openEditPanel(id){
    const it=items.find(x=>String(x.id)===String(id));
    if(!it)return;
    $('editItemId').value=id;
    $('editName').value=it.name;
    $('editType').value=it.type;
    $('editPct').value=it.pct||5;
    $('editSound').value=it.easterSound||'none';
    if(it.easterEgg){
        $('editImgPreview').src=it.easterEgg; $('editImgPreview').style.display='';
    } else {
        $('editImgPreview').style.display='none';
    }
    closeSlide('settingsPanel');
    openSlide('editItemPanel');
}

function saveEditItem(){
    const idVal=$('editItemId').value;
    const it=items.find(x=>String(x.id)===String(idVal));
    if(!it){alert('奖项不存在');return;}
    const n=$('editName').value.trim();
    if(!n){alert('请输入名称');return;}
    it.name=n;
    it.type=$('editType').value;
    it.pct=parseInt($('editPct').value)||5;
    it.easterSound=$('editSound').value;
    currentPctMap.set(it.id, it.pct); // 同步 currentPctMap
    save('items',items);
    rebuildPool();
    closeSlide('editItemPanel');
    renderItems(); renderSettings(); drawWheel(); updateUI();
    showToast('✅ 操作成功！');
}

function deleteCurrentItem(){
    const idVal=$('editItemId').value;
    if(!confirm('确定删除此奖项？'))return;
    deleteItem(idVal);
    closeSlide('editItemPanel');
}

function onEditEmojiUpload(e){
    const f=e.target.files[0]; if(!f)return;
    const reader=new FileReader();
    reader.onload=function(ev){
        const idVal=$('editItemId').value;
        const it=items.find(x=>String(x.id)===String(idVal));
        if(it){ it.easterEgg=ev.target.result; $('editImgPreview').src=ev.target.result; $('editImgPreview').style.display=''; }
    };
    reader.readAsDataURL(f);
}

function clearEditImg(){
    const idVal=$('editItemId').value;
    const it=items.find(x=>String(x.id)===String(idVal));
    if(it){ it.easterEgg=''; $('editImgPreview').style.display='none'; }
}



// ============ 渲染 ============
function renderItems(){
    const el=$('itemListEl');
    if(items.length===0){
        el.innerHTML='<div class="empty-hint"><div class="eh-icon">🎁</div><p>打开配置添加奖项</p></div>';
        return;
    }
    el.innerHTML=items.map(it=>{
        const dotCls = it.type==='positive'?'dot-pos':it.type==='negative'?'dot-neg':it.type==='neutral'?'dot-neutral':'dot-special';
        const typeText = it.type==='positive'?'👍褒':it.type==='negative'?'👎贬':it.type==='neutral'?'🔘中':'⭐特';
        const tags=[`<span class="tag">${typeText}</span>`];
        tags.push(`<span class="tag count">${it.pct||0}%</span>`);
        if(it.easterEgg) tags.push('<span class="tag has-easter">🎁彩蛋</span>');
        return `<div class="item-row">
            <div class="item-dot ${dotCls}"></div>
            <div class="item-body">
                <div class="item-name">${escHtml(it.name)}</div>
                <div class="item-tags">${tags.join('')}</div>
            </div>
            <button class="del-btn" onclick="openEditPanel(${it.id})" title="修改">✏️</button>
        </div>`;
    }).join('');
}

function renderSettings(){
    const el=$('settingsItemList');
    if(!el)return;
    if(items.length===0){ el.innerHTML='<p style="color:#64748b;font-size:13px">暂无，点击「新增」添加奖项</p>'; return; }
    const totalPct = Math.round(items.reduce((a,x)=>a+(x.pct||0),0));
    el.innerHTML=items.map(it=>{
        const tc = it.type==='positive'?'background:rgba(16,185,129,0.15);color:#10b981'
            :it.type==='negative'?'background:rgba(239,68,68,0.15);color:#ef4444'
            :it.type==='neutral'?'background:rgba(107,114,128,0.15);color:#9ca3af'
            :'background:rgba(245,158,11,0.15);color:#f59e0b';
        return `<div class="si-item">
            <div class="si-name">${escHtml(it.name)} ${it.easterEgg?'<span style="font-size:12px">🎁</span>':''}</div>
            <span class="si-type-tag" style="${tc}">${it.pct||0}%</span>
            <button class="si-del" onclick="openEditPanel(${it.id})" title="编辑">✏️</button>
            <button class="si-del" onclick="deleteItem(${it.id})" title="删除">✕</button>
        </div>`;
    }).join('') + `            <div style="font-size:12px;color:var(--text-muted);margin-top:8px;text-align:center">总设定占比：${totalPct}%${totalPct!==100?'（抽奖时自动按比例缩放至100%）':' ✓'}</div>
    <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <span style="font-size:13px;font-weight:600;color:var(--accent)">📉 抽奖后概率衰减</span>
            <label style="display:inline-flex;align-items:center;cursor:pointer">
                <input type="checkbox" id="decayToggle" style="accent-color:var(--accent);width:18px;height:18px" ${decayEnabled?'checked':''} onchange="onDecayToggle(this.checked)">
            </label>
        </div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.6;margin-bottom:12px">
            开启后：抽中某奖项时，其在转盘上的比例会动态减小（不保存，刷新即恢复）<br>
            衰减幅度：基数越大≈5%，基数越小≈0.1%，最低保留0.1%
        </div>
    </div>
    <div style="margin-top:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:13px;font-weight:600;color:var(--accent)">🔊 转盘音效音量</span>
            <span id="volumeLabel" style="font-size:13px;color:var(--text-muted)">${Math.round(soundVolume*100)}%</span>
        </div>
        <input type="range" id="volumeSlider" min="0" max="100" value="${Math.round(soundVolume*100)}"
            style="width:100%;accent-color:var(--accent)" oninput="onVolumeChange(this.value)">
    </div>
    <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <span style="font-size:13px;font-weight:600;color:var(--accent)">🐞 老虎机调试</span>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-muted);margin-bottom:10px;cursor:pointer">
            <input type="checkbox" id="slotDebugCheck" ${slotDebugMode ? 'checked' : ''} onchange="onSlotDebugChange(this.checked)">
            启用调试模式（使用预设值代替随机）
        </label>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
            <span style="font-size:13px;color:var(--text-muted)">第一位(0-2):</span>
            <input type="number" id="slotDebugD1" min="0" max="2" value="${slotDebugD1}"
                style="width:60px;padding:4px 8px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:14px"
                onchange="onSlotDebugD1Change(this.value)" ${slotDebugMode ? '' : 'disabled'}>
            <span style="font-size:13px;color:var(--text-muted)">第二位(0-9):</span>
            <input type="number" id="slotDebugD2" min="0" max="9" value="${slotDebugD2}"
                style="width:60px;padding:4px 8px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:14px"
                onchange="onSlotDebugD2Change(this.value)" ${slotDebugMode ? '' : 'disabled'}>
        </div>
        <button id="slotTestBtn" class="act-btn" style="width:100%;background:linear-gradient(135deg,#8b5cf6,#6366f1);font-size:13px;padding:8px 16px"
            onclick="testSlotMachine()" ${slotDebugMode ? '' : 'disabled'}>🧪 测试老虎机</button>
    </div>`;
}

function onVolumeChange(val) {
    soundVolume = parseInt(val) / 100;
    localStorage.setItem('l_volume', soundVolume.toString());
    const label = $('volumeLabel');
    if (label) label.textContent = val + '%';
}

function onDecayToggle(checked) {
    decayEnabled = checked === true || checked === 'true';
    localStorage.setItem('l_decay', decayEnabled.toString());
    // 切换时：重置 currentPctMap 为原始值（保证状态干净）
    resetCurrentPctMap();
    rebuildPool();
    drawWheel();
    renderItems();
    updateUI();
}

// ============ 老虎机调试 ============
function onSlotDebugChange(val) {
    slotDebugMode = val === true || val === 'true';
    localStorage.setItem('l_slot_debug', slotDebugMode.toString());
    const d1 = $('slotDebugD1');
    const d2 = $('slotDebugD2');
    const testBtn = $('slotTestBtn');
    if (d1) d1.disabled = !slotDebugMode;
    if (d2) d2.disabled = !slotDebugMode;
    if (testBtn) testBtn.disabled = !slotDebugMode;
}

function onSlotDebugD1Change(val) {
    const v = Math.max(0, Math.min(2, parseInt(val) || 0));
    slotDebugD1 = v;
    localStorage.setItem('l_slot_d1', v.toString());
}

function onSlotDebugD2Change(val) {
    const v = Math.max(0, Math.min(9, parseInt(val) || 0));
    slotDebugD2 = v;
    localStorage.setItem('l_slot_d2', v.toString());
}

function testSlotMachine() {
    if (!slotDebugMode) { alert('请先在配置面板开启调试模式！'); return; }
    const isPositive = confirm('是否测试【积分增长】老虎机？\n[确定]=增长，[取消]=减少');
    showSlot(isPositive);
}

function renderHistory(){
    const el=$('historyBody');
    const btn = el.querySelector('button');
    el.innerHTML='';
    if(history.length===0){
        el.innerHTML='<div class="empty-hint"><div class="eh-icon">📭</div><p>暂无记录</p></div>';
        if(btn) el.appendChild(btn);
        return;
    }
    history.forEach(h=>{
        const div=document.createElement('div');
        div.className='hi-item';
        div.innerHTML=`${h.emoji?`<img src="${h.emoji}" style="width:40px;height:40px;border-radius:10px;object-fit:cover"/>`:'<div class="hi-icon">🎲</div>'}<div class="hi-info"><div class="hi-name">${escHtml(h.name)}</div><div class="hi-time">${h.time}</div></div>`;
        el.appendChild(div);
    });
    if(btn) el.appendChild(btn);
}

function updateUI(){
    $('spinBtn').disabled=spinning || pool.length<2;
}

// ============ 彩蛋上传 ============
function onEmojiUpload(e){
    const f=e.target.files[0]; if(!f)return;
    const reader = new FileReader();
    reader.onload=function(ev){
        uploadedEmojiData=ev.target.result;
        const p=$('emojiPrev');
        p.src=uploadedEmojiData; p.style.display='';
    };
    reader.readAsDataURL(f);
}

// ============ 滑动面板 ============
function openSlide(id){
    // 关闭其他面板
    closeAllSlides();
    $(id).classList.add('open');
    $('backdrop').classList.add('show');
    if(id==='settingsPanel') renderSettings();
    if(id==='newItemPanel'){
        $('inpName').value=''; $('inpPct').value=5; $('inpType').value='positive';
        $('inpSound').value='none'; $('emojiPrev').style.display='none';
        uploadedEmojiData=null; $('emojiFile').value='';
    }
}
function closeSlide(id){$(id).classList.remove('open');$('backdrop').classList.remove('show');}
function closeAllSlides(){document.querySelectorAll('.slide-panel.open').forEach(s=>s.classList.remove('open'));$('backdrop').classList.remove('show');}

function switchTab(btn,mode){
    document.querySelectorAll('.tbtn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
}

function addHist(it){
    history.unshift({name:it.name,type:it.type,emoji:it.easterEgg||'',time:new Date().toLocaleString('zh-CN')});
    if(history.length>80)history.pop();
    save('history',history); renderHistory();
}

function clearHist(){if(confirm('清空历史？')){history=[];save('history',history);renderHistory();}}

// ============ 积分老虎机 ============
let slotAnimRaf = null;
let slotStopRequested = false;
let slotIsPositive = true;
let slotFinalDigit1 = 0;
let slotFinalDigit2 = 0;

function showSlot(isPositive) {
    const overlay = $('slotOverlay');
    const title = $('slotTitle');
    title.textContent = isPositive ? '🎰 积分增长老虎机 🎰' : '🎰 积分减少老虎机 🎰';
    $('slot0').textContent = '0';
    $('slot1').textContent = '?';
    $('slot2').textContent = '?';
    $('slot0').classList.remove('stopped');
    $('slot1').classList.remove('stopped');
    $('slot2').classList.remove('stopped');
    $('slotResult').textContent = '';
    $('slotResult').className = 'slot-result';
    $('slotStopBtn').style.display = '';
    $('slotCloseBtn').style.display = 'none';

    slotIsPositive = isPositive;

    if (slotDebugMode) {
        slotFinalDigit1 = slotDebugD1;
        slotFinalDigit2 = slotDebugD2;
    } else {
        const r1 = Math.random() * 100;
        if (r1 < 5) slotFinalDigit1 = 2;
        else if (r1 < 30) slotFinalDigit1 = 1;
        else slotFinalDigit1 = 0;
        slotFinalDigit2 = Math.floor(Math.random() * 10);
    }

    slotStopRequested = false;
    overlay.classList.add('show');
    slotAnimRaf = requestAnimationFrame(slotAnimLoop);
}

function slotAnimLoop() {
    if (slotStopRequested) {
        // 停止：显示最终结果
        $('slot1').textContent = slotFinalDigit1;
        $('slot2').textContent = slotFinalDigit2;
        $('slot1').classList.add('stopped');
        $('slot2').classList.add('stopped');

        // 当第二位是0时，第一位不显示0（避免显示 "00X"）
        if (slotFinalDigit1 === 0) {
            $('slot0').textContent = '';
            $('slot0').style.visibility = 'hidden';
        } else {
            $('slot0').textContent = '0';
            $('slot0').style.visibility = 'visible';
        }
        $('slot0').classList.add('stopped');

        // 显示结果（去掉前导零）
        const finalValue = slotFinalDigit1 * 10 + slotFinalDigit2; // 0-29
        if (slotIsPositive) {
            $('slotResult').textContent = '🎉 获得 ' + finalValue + ' 积分！';
            $('slotResult').className = 'slot-result positive';
        } else {
            $('slotResult').textContent = '😈 失去 ' + finalValue + ' 积分！';
            $('slotResult').className = 'slot-result negative';
        }

        $('slotStopBtn').style.display = 'none';
        $('slotCloseBtn').style.display = '';
        return;
    }

    // 滚动中：随机数字
    $('slot1').textContent = Math.floor(Math.random() * 10);
    $('slot2').textContent = Math.floor(Math.random() * 10);
    slotAnimRaf = requestAnimationFrame(slotAnimLoop);
}

function stopSlotManual() {
    slotStopRequested = true;
}

function closeSlot() {
    $('slotOverlay').classList.remove('show');
    if (slotAnimRaf) cancelAnimationFrame(slotAnimRaf);
}

function toggleFS(){
    if(!document.fullscreenElement)document.documentElement.requestFullscreen();
    else document.exitFullscreen();
}

// ============ 保存为默认配置 ============
function saveAsDefault() {
    if (items.length === 0) { alert('当前没有奖项配置可保存！'); return; }
    if (!confirm('将当前奖项配置保存为默认配置？\n下次点击「加载默认奖项」时将加载此配置。')) return;
    localStorage.setItem('l_default_items', JSON.stringify(items));
    alert('✅ 已保存为默认配置！');
}

// ============ 配置导出 ============
function exportConfig() {
    const config = {
        version: '1.0',
        exportTime: new Date().toLocaleString('zh-CN'),
        items: items,
        points: points,
        selectedSound: selectedSound,
        soundOn: soundOn
    };
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lottery_config_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert('✅ 配置已导出！');
}

// ============ 配置导入 ============
function importConfig(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const config = JSON.parse(e.target.result);
            if (!config.items || !Array.isArray(config.items)) {
                alert('❌ 配置文件格式错误！');
                return;
            }
            if (items.length > 0 && !confirm('导入将覆盖当前奖项配置，确定继续？')) {
                event.target.value = '';
                return;
            }
            items = config.items.map(it => ({
                id: it.id || Date.now() + Math.random(),
                name: it.name,
                type: it.type || 'positive',
                pct: it.pct || it.count || 5,
                easterEgg: it.easterEgg || '',
                easterSound: it.easterSound || 'meow'
            }));
            if (config.points !== undefined) points = config.points;
            if (config.selectedSound) selectedSound = config.selectedSound;
            if (config.soundOn !== undefined) soundOn = config.soundOn;

            save('items', items);
            save('points', points);
            save('sound', selectedSound);
            save('soundOn', soundOn);
            rebuildPool();
            drawWheel();
            renderItems();
            renderSettings();
            updateUI();
            alert('✅ 配置导入成功！');
        } catch (err) {
            alert('❌ 导入失败：' + err.message);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function loadDefaultItems() {
    if (items.length > 0 && !confirm('加载默认奖项将覆盖当前配置，确定继续？')) return;
    let defaultItems = [];
    try {
        defaultItems = JSON.parse(localStorage.getItem('l_default_items') || '[]');
    } catch(e) {}
    if (defaultItems.length === 0) {
        defaultItems = DEFAULT_ITEMS;
    }
    items = defaultItems.map((it, i) => ({ ...it, id: Date.now() + i }));
    save('items', items);
    rebuildPool();
    drawWheel();
    renderItems();
    renderSettings();
    updateUI();
    alert('✅ 已加载默认奖项！');
}

// ============ ESC关闭 ============
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeAllSlides(); closeResult();}});

// 点击转盘
$('wheelWrap').addEventListener('click',e=>{
    const r=$('wheelWrap').getBoundingClientRect();
    const dx=e.clientX-r.left-r.width/2, dy=e.clientY-r.top-r.height/2;
    if(Math.hypot(dx,dy)<=r.width/2) doSpin();
});

window.addEventListener('resize',()=>{ wheelSz = 0; wheelCache = null; drawWheel(); initBg(); });

// ============ 工具函数 ============
function escHtml(s){
    const d=document.createElement('div'); d.textContent=s; return d.innerHTML;
}

// ============ 转盘持续渲染（驱动特殊扇形脉冲光效）============
let wheelAnimRunning = false;
function startWheelLoop() {
    if (wheelAnimRunning) return;
    wheelAnimRunning = true;
    function loop() {
        if (!spinning) drawWheel(); // spinning 时由 doSpin 内的 anim 驱动
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}

// ============ 动态背景 ============
function initBg(){
    const cv=$('bgCanvas');
    const ctx=cv.getContext('2d');
    function resize(){cv.width=cv.offsetWidth;cv.height=cv.offsetHeight;}
    resize(); window.addEventListener('resize',resize);
    const pts=[];
    for(let i=0;i<50;i++)pts.push({
        x:Math.random()*cv.width,y:Math.random()*cv.height,
        vx:(Math.random()-0.5)*0.3,vy:(Math.random()-0.5)*0.3,
        r:Math.random()*2+0.5,a:Math.random()*0.5+0.1
    });

    function frame(){
        ctx.clearRect(0,0,cv.width,cv.height);
        const grd=ctx.createRadialGradient(cv.width*0.3,cv.height*0.3,0,cv.width*0.5,cv.height*0.5,cv.width*0.8);
        grd.addColorStop(0,'#111827'); grd.addColorStop(0.5,'#0a0e17'); grd.addColorStop(1,'#030712');
        ctx.fillStyle=grd; ctx.fillRect(0,0,cv.width,cv.height);
        ctx.strokeStyle='rgba(99,102,241,0.03)'; ctx.lineWidth=0.5;
        const gs=60;
        for(let x=0;x<cv.width;x+=gs){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,cv.height);ctx.stroke();}
        for(let y=0;y<cv.height;y+=gs){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(cv.width,y);ctx.stroke();}
        pts.forEach(p=>{
            p.x+=p.vx; p.y+=p.vy;
            if(p.x<0)p.x=cv.width;if(p.x>cv.width)p.x=0;
            if(p.y<0)p.y=cv.height;if(p.y>cv.height)p.y=0;
            ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
            ctx.fillStyle=`rgba(99,102,241,${p.a})`; ctx.fill();
        });
        requestAnimationFrame(frame);
    }
    frame();
}

// ============ 贬类嘲笑表情包动画 ============
function showLaughAtEmoji() {
    const el = document.createElement('img');
    el.src = 'emoji_laugh_at.webp';
    el.style.cssText = 'position:fixed;z-index:10000;pointer-events:none;' +
        'width:120px;height:120px;left:50%;top:50%;object-fit:contain;';

    // 缓动函数
    const easeOutBack = t => {
        const c1 = 1.70158, c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    };
    const easeInOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2;
    const easeInCubic = t => t * t * t;

    // 阶段1: easeOutBack从0%放大到100% + easeInOutSine角度缓动（0.6秒）
    // 阶段2: 停留（~2.4秒）
    // 阶段3: easeInCubic缩小 + easeInCubic上移（0.6秒，总计3秒后开始）

    const phase1Dur = 600;
    const phase2Dur = 1800;
    const phase3Dur = 600;
    const totalDur = phase1Dur + phase2Dur + phase3Dur;
    const maxAngle = 12; // 角度小一点，12度来回摆动

    let startTime = null;

    document.body.appendChild(el);

    function animFrame(now) {
        if (!startTime) startTime = now;
        const elapsed = now - startTime;

        if (elapsed >= totalDur) {
            el.remove();
            return;
        }

        let scale, translateY, rotate;

        if (elapsed < phase1Dur) {
            // 阶段1: 放大 + 角度缓动
            const p = elapsed / phase1Dur;
            scale = easeOutBack(p);
            translateY = 0;
            rotate = easeInOutSine(p) * maxAngle;
        } else if (elapsed < phase1Dur + phase2Dur) {
            // 阶段2: 保持大小，角度继续缓动
            const p = (elapsed - phase1Dur) / phase2Dur;
            scale = 1;
            translateY = 0;
            // 角度来回摆动
            rotate = Math.sin(p * Math.PI * 3) * maxAngle * 0.5;
        } else {
            // 阶段3: 缩小 + 上移
            const p = (elapsed - phase1Dur - phase2Dur) / phase3Dur;
            const ep = easeInCubic(p);
            scale = 1 - ep;
            translateY = -200 * ep; // 向上移出屏幕
            rotate = 0;
        }

        el.style.transform = `translate(-50%, -50%) scale(${scale}) translateY(${translateY}px) rotate(${rotate}deg)`;
        requestAnimationFrame(animFrame);
    }

    requestAnimationFrame(animFrame);
}

// ============ Toast 提示 ============
function showToast(msg, duration) {
    duration = duration || 2000;
    let t = document.getElementById('_toast_el');
    if (!t) {
        t = document.createElement('div');
        t.id = '_toast_el';
        t.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:9999;' +
            'padding:12px 28px;border-radius:14px;font-size:15px;font-weight:700;pointer-events:none;' +
            'background:rgba(16,185,129,0.92);color:#fff;box-shadow:0 6px 24px rgba(0,0,0,0.3);' +
            'backdrop-filter:blur(8px);opacity:0;transition:opacity 0.3s';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, duration);
}