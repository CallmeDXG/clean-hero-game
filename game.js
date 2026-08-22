/* 解压清扫 3D —— 纯 HTML5 + Three.js(r128)
 * 设计：全年龄休闲 / 不计时沙盒 / 跨端小程序(web-view)
 * 详见同级 docs/GDD.md。未 playtest 的数值均标 [PLACEHOLDER]。
 */
(function () {
  'use strict';
  const T = window.THREE;
  if (!T) { document.getElementById('err').style.display = 'flex'; return; }

  // ---------------- Tuning ----------------
  const ROOM_SIZE = 12;          // 地板边长(世界单位)
  const GRID = 64;               // 清洁度统计网格(廉价,免 getImageData)
  const DIRT_W = 1024, DIRT_H = 1024;
  const TOOLS = {
    mop:    { name: '拖把',   icon: '🧹', radius: 1.5, pick: false }, // 半径大=快但无细节
    broom:  { name: '扫帚',   icon: '🧽', radius: 0.9, pick: true  }, // 中范围+可扫垃圾
    vacuum: { name: '吸尘器', icon: '🌪️', radius: 1.1, pick: true  }, // 中范围+吸垃圾+独特音效
  };
  const ROOMS = [
    { id: 'bedroom',  name: '温馨卧室', floor: 0xf3e9d8, wall: 0xe7d8c4, dirt: 90,  trash: 8,  dirtColor: [92, 74, 52] },
    { id: 'kitchen',  name: '清爽厨房', floor: 0xdfe7e3, wall: 0xcdd9d4, dirt: 110, trash: 10, dirtColor: [120, 96, 46] },
    { id: 'bathroom', name: '明亮浴室', floor: 0xe3eef5, wall: 0xcfe0ec, dirt: 80,  trash: 6,  dirtColor: [108, 128, 128] },
  ];

  // 家具按房间分池:开箱只掏本房间的专属家具,所以每个房间开出来的都不一样
  // 每件家具是 Group,底座在 y=0;灶台标注 isStove+cooktopY,锅标注 kind='pot' 以便吸附
  function fm(sx, sy, sz, color, x, y, z, rough) {
    const m = new T.Mesh(new T.BoxGeometry(sx, sy, sz),
      new T.MeshStandardMaterial({ color: color, roughness: rough === undefined ? 0.8 : rough }));
    m.position.set(x, y, z); m.castShadow = true; return m;
  }
  const FURN = {
    bedroom: [
      () => { // 床
        const g = new T.Group();
        g.add(fm(2.0, 0.4, 2.6, 0x8d6e63, 0, 0.2, 0));
        g.add(fm(1.85, 0.25, 2.4, 0xfaf3e8, 0, 0.52, 0));
        g.add(fm(1.4, 0.18, 0.5, 0xffffff, 0, 0.66, -0.85));
        g.add(fm(2.0, 0.8, 0.15, 0x8d6e63, 0, 0.6, -1.3));
        return g;
      },
      () => { // 衣柜
        const g = new T.Group();
        g.add(fm(1.2, 2.0, 0.6, 0xa1887f, 0, 1.0, 0));
        const hMat = new T.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.6 });
        [-0.15, 0.15].forEach(x => {
          const h = new T.Mesh(new T.BoxGeometry(0.06, 0.3, 0.06), hMat);
          h.position.set(x, 1.0, 0.31); g.add(h);
        });
        return g;
      },
      () => { // 化妆桌 + 圆镜 + 凳
        const g = new T.Group();
        g.add(fm(1.4, 0.1, 0.6, 0xd7b899, 0, 0.75, 0));
        [[-0.62, -0.22], [0.62, -0.22], [-0.62, 0.22], [0.62, 0.22]].forEach(([x, z]) => g.add(fm(0.08, 0.75, 0.08, 0xd7b899, x, 0.375, z)));
        const mir = fm(0.9, 0.7, 0.05, 0xe1f5fe, 0, 1.35, -0.18);
        mir.material.emissive = new T.Color(0x9fd8ff); mir.material.emissiveIntensity = 0.25; g.add(mir);
        const stool = new T.Mesh(new T.CylinderGeometry(0.28, 0.28, 0.4, 16), new T.MeshStandardMaterial({ color: 0xd7b899, roughness: 0.8 }));
        stool.position.set(0, 0.2, 0.55); stool.castShadow = true; g.add(stool);
        return g;
      },
    ],
    kitchen: [
      () => { // 灶台(锅可放其上)
        const g = new T.Group();
        g.add(fm(1.6, 0.85, 0.7, 0xb0b8bc, 0, 0.425, 0));    // 柜体
        g.add(fm(1.5, 0.08, 0.65, 0x2b2f31, 0, 0.89, 0));    // 黑色玻璃台面
        const bMat = new T.MeshStandardMaterial({ color: 0x555555, roughness: 0.5 });
        [[-0.4, -0.15], [0.4, -0.15], [-0.4, 0.15], [0.4, 0.15]].forEach(([x, z]) => {
          const b = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 0.04, 18), bMat);
          b.position.set(x, 0.94, z); g.add(b);
        });
        g.userData.isStove = true; g.userData.cooktopY = 0.93; // 锅吸附高度
        return g;
      },
      () => { // 油烟机(独立立式)
        const g = new T.Group();
        g.add(fm(0.25, 1.6, 0.25, 0x9aa0a4, 0, 0.8, 0));      // 立管
        g.add(fm(1.3, 0.4, 0.55, 0x9aa0a4, 0, 1.8, 0));       // 罩体
        return g;
      },
      () => { // 锅(可放灶台上)
        const g = new T.Group();
        const m = new T.MeshStandardMaterial({ color: 0x2b6cb0, roughness: 0.5, metalness: 0.35 });
        const body = new T.Mesh(new T.CylinderGeometry(0.34, 0.28, 0.4, 22), m); body.position.y = 0.2; body.castShadow = true; g.add(body);
        const rim = new T.Mesh(new T.TorusGeometry(0.34, 0.04, 8, 22), m); rim.position.y = 0.4; rim.rotation.x = Math.PI / 2; g.add(rim);
        const hd = new T.Mesh(new T.BoxGeometry(0.4, 0.06, 0.08), m); hd.position.set(0.42, 0.32, 0); g.add(hd);
        g.userData.kind = 'pot';
        return g;
      },
    ],
    bathroom: [
      () => { // 花洒
        const g = new T.Group();
        g.add(fm(0.05, 2.2, 0.05, 0xcfd8dc, 0, 1.1, 0));
        const head = new T.Mesh(new T.CylinderGeometry(0.22, 0.16, 0.18, 16), new T.MeshStandardMaterial({ color: 0xb0bec5, roughness: 0.5 }));
        head.position.set(0, 2.2, 0); head.rotation.z = 0.4; g.add(head);
        g.add(fm(0.5, 0.05, 0.5, 0xcfd8dc, 0, 0.02, 0));
        return g;
      },
      () => { // 马桶
        const g = new T.Group();
        g.add(fm(0.6, 0.5, 0.7, 0xf5f5f5, 0, 0.25, 0));
        g.add(fm(0.62, 0.08, 0.5, 0xeeeeee, 0, 0.52, 0.02));
        g.add(fm(0.6, 0.5, 0.2, 0xf5f5f5, 0, 0.6, -0.35));
        return g;
      },
      () => { // 地毯
        const g = new T.Group();
        const r = new T.Mesh(new T.BoxGeometry(2.0, 0.04, 1.4), new T.MeshStandardMaterial({ color: 0x6ec6e6, roughness: 0.95 }));
        r.position.y = 0.02; r.receiveShadow = true; g.add(r); return g;
      },
      () => { // 毛巾架(立式)+毛巾
        const g = new T.Group();
        g.add(fm(0.08, 1.3, 0.08, 0xb0bec5, -0.4, 0.65, 0));
        g.add(fm(0.08, 1.3, 0.08, 0xb0bec5, 0.4, 0.65, 0));
        const bar = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.85, 10), new T.MeshStandardMaterial({ color: 0x90a4ae }));
        bar.rotation.z = Math.PI / 2; bar.position.set(0, 1.25, 0); g.add(bar);
        g.add(fm(0.34, 0.6, 0.06, 0x90caf9, 0, 0.95, 0.05));
        return g;
      },
      () => { // 镜子(立式带底座)
        const g = new T.Group();
        g.add(fm(0.7, 0.06, 0.4, 0xcfd8dc, 0, 0.03, 0));
        const frame = fm(0.9, 1.2, 0.06, 0xcfd8dc, 0, 0.65, 0); g.add(frame);
        const gl = fm(0.74, 1.0, 0.02, 0xe1f5fe, 0, 0.65, 0.03);
        gl.material.emissive = new T.Color(0xbfe9ff); gl.material.emissiveIntensity = 0.25; g.add(gl);
        return g;
      },
      () => { // 洗手池(柜体+台盆+龙头)
        const g = new T.Group();
        g.add(fm(1.0, 0.8, 0.5, 0xbcaaa4, 0, 0.4, 0));
        g.add(fm(0.8, 0.15, 0.4, 0xfafafa, 0, 0.85, 0));
        const fct = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.25, 10), new T.MeshStandardMaterial({ color: 0x90a4ae, metalness: 0.5 }));
        fct.position.set(0, 1.0, -0.1); g.add(fct);
        return g;
      },
    ],
  };
  // [PLACEHOLDER] dirt/trash 数量、半径、权重均待 playtest 调整
  const W_FLOOR = 0.8, W_TRASH = 0.2; // 清洁度加权(墙不再有污渍,仅地板+垃圾)
  const COMPLETE = 0.95;                            // 完成阈值(非100%,避免边缘像素强迫症)

  // ---------------- 经济(金币) ----------------
  // 来源 Source: 擦净脏污格 / 捡垃圾 / 通关奖励
  // 消耗 Sink:  商店升级工具(放大刷头面积)
  const COIN_PER_CELL = 0.05;  // [PLACEHOLDER] 每擦净一格脏污
  const COIN_PER_TRASH = 3;    // [PLACEHOLDER] 捡一件垃圾
  const COMPLETE_BONUS = 50;   // [PLACEHOLDER] 通关奖励
  const TOOL_STEP = 0.35;      // [PLACEHOLDER] 每级放大的刷头半径增量
  const TOOL_MAX_LV = 4;       // 单工具最大升级等级
  const FURN_PER_BOX = 10;     // [PLACEHOLDER] 每个奖励箱子开出的家具数量
  const SAVE_KEY = 'cleanhero_save_v1';
  // 从 level 升到 level+1 的花费(递增): 60→108→194→349 (满级约 711)
  function toolCost(lv) { return Math.round(60 * Math.pow(1.8, lv)); }

  // ---------------- State ----------------
  const S = {
    scene: null, camera: null, renderer: null, ray: new T.Raycaster(),
    roomGroup: null, floor: null,
    dirtCanvas: null, dirtCtx: null, dirtTex: null, dirtMesh: null,
    dirtyCells: null, cleanedCells: null, totalDirty: 0,
    trash: [],
    tool: 'mop', roomIndex: 0,
    totalTrash: 0,
    cleanFloor: 0, cleanTrash: 0, done: false,
    particles: [], boxes: [], furn: [], reveals: [], revealBoxes: [], softTex: null,
    cam: { r: 15, theta: Math.PI * 0.25, phi: Math.PI * 0.34, target: new T.Vector3(0, 0.6, 0) },
    pointers: new Map(), twoFinger: false, brushing: false, started: false,
    furnDragging: null, furnPending: null, longPressT: null,
    floorPlane: new T.Plane(new T.Vector3(0, 1, 0), 0),
    ceiling: null, ceilingY: 4, pendant: null, windows: [], lamp: null,
    advTimer: null,
    furnGroup: null, furnByRoom: {},
    coins: 0, toolLevels: { mop: 0, broom: 0, vacuum: 0 },
    audio: null,
  };

  // ---------------- Utils ----------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);

  // 金币存档(切关/刷新不丢)
  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (typeof d.coins === 'number') S.coins = d.coins;
        if (d.toolLevels) Object.assign(S.toolLevels, d.toolLevels);
      }
    } catch (e) { /* 隐私模式/无 localStorage 时静默降级 */ }
  }
  function saveSave() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ coins: S.coins, toolLevels: S.toolLevels })); } catch (e) {}
  }
  // 工具有效半径(含升级放大)
  function toolRadius(k) { return TOOLS[k].radius + (S.toolLevels[k] || 0) * TOOL_STEP; }
  function addCoins(n) {
    S.coins += n;
    const el = document.getElementById('coinNum');
    if (el) el.textContent = Math.floor(S.coins);
    const pop = document.getElementById('coinPop');
    if (pop) { pop.textContent = '+' + Math.round(n); pop.classList.remove('show'); void pop.offsetWidth; pop.classList.add('show'); }
    saveSave();
  }

  function makeSoftTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const tx = new T.CanvasTexture(c); return tx;
  }

  // ---------------- Scene ----------------
  function initScene() {
    S.scene = new T.Scene();
    S.scene.background = new T.Color(0x222633);
    S.scene.fog = new T.Fog(0x222633, 18, 40);

    S.camera = new T.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    updateCamera();

    S.renderer = new T.WebGLRenderer({ antialias: true });
    S.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    S.renderer.setSize(window.innerWidth, window.innerHeight);
    S.renderer.shadowMap.enabled = true;
    document.getElementById('app').appendChild(S.renderer.domElement);

    S.scene.add(new T.HemisphereLight(0xffffff, 0x404050, 0.9));
    const dir = new T.DirectionalLight(0xffffff, 0.8);
    dir.position.set(6, 12, 4); dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -10; dir.shadow.camera.right = 10;
    dir.shadow.camera.top = 10; dir.shadow.camera.bottom = -10;
    S.scene.add(dir);

    // 持久家具层:独立于 roomGroup,房间重建/切关时不丢失玩家布置
    S.furnGroup = new T.Group();
    S.scene.add(S.furnGroup);

    S.softTex = makeSoftTexture();
    window.addEventListener('resize', onResize);
  }

  function updateCamera() {
    const { r, theta, phi, target } = S.cam;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    S.camera.position.set(
      target.x + r * sp * Math.sin(theta),
      target.y + r * cp,
      target.z + r * sp * Math.cos(theta)
    );
    S.camera.lookAt(target);
    // 天花板/吊灯仅在相机降到其以下(双指把视角压低到特定角度)时显现,否则挡视线
    const belowCeil = S.camera.position.y < S.ceilingY - 0.3;
    if (S.ceiling) S.ceiling.visible = belowCeil;
    if (S.pendant) S.pendant.visible = belowCeil;
  }

  function onResize() {
    S.camera.aspect = window.innerWidth / window.innerHeight;
    S.camera.updateProjectionMatrix();
    S.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ---------------- Room ----------------
  function buildRoom(cfg) {
    if (S.roomGroup) S.scene.remove(S.roomGroup);
    const g = new T.Group(); S.roomGroup = g; S.scene.add(g);

    // 地板
    const floorMat = new T.MeshStandardMaterial({ color: cfg.floor, roughness: 0.95 });
    S.floor = new T.Mesh(new T.PlaneGeometry(ROOM_SIZE, ROOM_SIZE), floorMat);
    S.floor.rotation.x = -Math.PI / 2; S.floor.receiveShadow = true;
    S.floor.name = 'floor'; g.add(S.floor);

    // 脏污覆盖层(透明背景+深色污渍,擦除即显出干净地板)
    S.dirtCanvas = document.createElement('canvas');
    S.dirtCanvas.width = DIRT_W; S.dirtCanvas.height = DIRT_H;
    S.dirtCtx = S.dirtCanvas.getContext('2d');
    S.dirtTex = new T.CanvasTexture(S.dirtCanvas);
    const dirtMat = new T.MeshBasicMaterial({ map: S.dirtTex, transparent: true, depthWrite: false });
    S.dirtMesh = new T.Mesh(new T.PlaneGeometry(ROOM_SIZE, ROOM_SIZE), dirtMat);
    S.dirtMesh.rotation.x = -Math.PI / 2; S.dirtMesh.position.y = 0.012;
    S.dirtMesh.name = 'dirt'; g.add(S.dirtMesh);

    // 仅保留后墙(-Z)与左墙(-X,均带窗);前墙(+Z)与右墙(+X)去掉,做成敞口剖面视野
    const wallMat = new T.MeshStandardMaterial({ color: cfg.wall, roughness: 1, side: T.DoubleSide });
    const wh = 4, half = ROOM_SIZE / 2;
    const walls = [
      { p: [0, wh / 2, -half], r: [0, 0, 0] },            // 后墙(-Z,带窗)
      { p: [-half, wh / 2, 0], r: [0, Math.PI / 2, 0] },  // 左墙(-X,带窗)
    ];
    walls.forEach(w => {
      const m = new T.Mesh(new T.PlaneGeometry(ROOM_SIZE, wh), wallMat);
      m.position.set(w.p[0], w.p[1], w.p[2]); m.rotation.set(w.r[0], w.r[1], w.r[2]);
      m.receiveShadow = true; g.add(m);
    });

    // 窗户(装饰,不参与清扫);其余家具已移除,房间保持极简
    buildWindows(g);

    // 天花板:默认隐藏,双指把视角压低到相机降到天花板以下时才显现,避免高角度俯视被挡
    const ceilMat = new T.MeshStandardMaterial({
      color: 0xf2eee6, roughness: 1, side: T.DoubleSide,
      emissive: 0xece6dc, emissiveIntensity: 0.25
    });
    const ceil = new T.Mesh(new T.PlaneGeometry(ROOM_SIZE, ROOM_SIZE), ceilMat);
    ceil.rotation.x = Math.PI / 2; // 水平朝下
    ceil.position.y = wh; ceil.visible = false;
    g.add(ceil);
    S.ceiling = ceil; S.ceilingY = wh;

    // 吊灯:挂在天花板上,与天花板同显隐(双指压低视角仰视才看得到,避免挡俯视)
    const pend = new T.Group();
    const cord = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 1.2, 8),
      new T.MeshStandardMaterial({ color: 0x444444, roughness: 0.6 }));
    cord.position.y = wh - 0.6; pend.add(cord); // 顶端贴天花板(y=wh)
    const shade = new T.Mesh(new T.CylinderGeometry(0.35, 0.5, 0.45, 16, 1, true),
      new T.MeshStandardMaterial({ color: 0x6b5640, roughness: 0.6, side: T.DoubleSide, emissive: 0x3a2c1a, emissiveIntensity: 0.2 }));
    shade.position.y = wh - 1.4; pend.add(shade);
    const bulb = new T.Mesh(new T.SphereGeometry(0.18, 16, 16),
      new T.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffe9a8, emissiveIntensity: 0.9 }));
    bulb.position.y = wh - 1.55; pend.add(bulb);
    const pl = new T.PointLight(0xffe6b0, 0.6, 12, 2); // [PLACEHOLDER] 暖光,无阴影省性能
    pl.position.y = wh - 1.55; pend.add(pl);
    pend.visible = false;
    g.add(pend);
    S.pendant = pend;
    S.lamp = { bulb: bulb, light: pl, on: true, hit: [bulb, shade] };

    generateDirt(cfg);
    spawnTrash(cfg);

    S.totalTrash = S.trash.length;
    S.cleanFloor = S.cleanTrash = 0; S.done = false;
    S.boxes = [];
    // 持久化家具:从本关存档(按房间)重建到独立的 furnGroup,不随 roomGroup 重建而丢失
    while (S.furnGroup.children.length) S.furnGroup.remove(S.furnGroup.children[0]);
    S.furn = []; S.furnDragging = null; S.furnPending = null;
    if (S.longPressT) { clearTimeout(S.longPressT); S.longPressT = null; }
    S.reveals = []; S.revealBoxes = [];
    S.windows = []; S.lamp = null;
    const inv = S.furnByRoom[S.roomIndex] || [];
    for (const e of inv) {
      const fac = FURN[cfg.id] && FURN[cfg.id][e.idx]; // 旧存档 idx 越界则跳过
      if (!fac) continue;
      const fur = fac();
      fur.position.set(e.x, e.y || 0, e.z);
      fur.rotation.y = e.ry;
      fur.userData.inv = e;
      S.furnGroup.add(fur);
      S.furn.push(fur);
    }
    updateCamera(); // 按当前相机高度刷新天花板可见性
  }

  // 窗户:后墙(-Z)与左墙(-X)在默认视角内,各开一扇;装饰,不参与清扫
  function buildWindows(g) {
    const half = ROOM_SIZE / 2;
    addWindow(g, 0, 2.2, -half + 0.06, 0, 3.2, 2.2);
    addWindow(g, -half + 0.06, 2.2, 0, Math.PI / 2, 3.2, 2.2);
  }
  function addWindow(g, x, y, z, ry, w, h) {
    const grp = new T.Group();
    const ft = 0.14, fd = 0.22;
    const frameMat = new T.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.7 });
    const glassMat = new T.MeshStandardMaterial({
      color: 0xbfe6ff, transparent: true, opacity: 0.5,
      emissive: 0x9fd0ff, emissiveIntensity: 0.5, roughness: 0.1,
      side: T.DoubleSide, depthWrite: false
    });
    const glass = new T.Mesh(new T.PlaneGeometry(w, h), glassMat);
    glass.position.z = 0.02; grp.add(glass);
    const top = new T.Mesh(new T.BoxGeometry(w + 2 * ft, ft, fd), frameMat); top.position.set(0, h / 2, 0);
    const bot = new T.Mesh(new T.BoxGeometry(w + 2 * ft, ft, fd), frameMat); bot.position.set(0, -h / 2, 0);
    const lft = new T.Mesh(new T.BoxGeometry(ft, h, fd), frameMat); lft.position.set(-w / 2 - ft / 2, 0, 0);
    const rgt = new T.Mesh(new T.BoxGeometry(ft, h, fd), frameMat); rgt.position.set(w / 2 + ft / 2, 0, 0);
    const midV = new T.Mesh(new T.BoxGeometry(ft * 0.8, h, fd), frameMat); midV.position.set(0, 0, 0);
    const midH = new T.Mesh(new T.BoxGeometry(w, ft * 0.8, fd), frameMat); midH.position.set(0, 0, 0);
    const sill = new T.Mesh(new T.BoxGeometry(w + 2 * ft, ft * 0.7, fd * 1.3), frameMat); sill.position.set(0, -h / 2 - ft * 0.4, fd * 0.25);
    [top, bot, lft, rgt, midV, midH, sill].forEach(m => { m.castShadow = true; grp.add(m); });
    glass.castShadow = false;

    // 窗帘机关:两片布帘,关闭时合拢遮窗,打开时滑向两侧
    const curMat = new T.MeshStandardMaterial({ color: 0xe7d8b8, roughness: 1, side: T.DoubleSide });
    const cw = w / 2, ch = h * 1.05;
    const mkCurtain = (side) => {
      const m = new T.Mesh(new T.PlaneGeometry(cw, ch), curMat);
      m.position.z = 0.08; // 在玻璃前方(朝房间内)
      m.userData.closedX = side * cw / 2;             // 合拢:各遮半边
      m.userData.openX = side * (w / 2 + cw * 0.05);  // 打开:滑到边缘外
      m.position.x = m.userData.closedX;
      grp.add(m);
      return m;
    };
    const curL = mkCurtain(-1), curR = mkCurtain(1);

    grp.position.set(x, y, z);
    grp.rotation.y = ry;
    g.add(grp);

    S.windows.push({ curtains: [curL, curR], hit: [glass, curL, curR], open: false });
  }

  function generateDirt(cfg) {
    const ctx = S.dirtCtx;
    ctx.clearRect(0, 0, DIRT_W, DIRT_H);
    S.dirtyCells = new Uint8Array(GRID * GRID);
    S.cleanedCells = new Uint8Array(GRID * GRID);
    S.totalDirty = 0;

    for (let i = 0; i < cfg.dirt; i++) {
      const u = Math.random(), v = Math.random();
      const pr = rand(16, 46);                       // 像素半径
      const cx = u * DIRT_W, cy = (1 - v) * DIRT_H;
      const dc = cfg.dirtColor || [92, 74, 52];
      const grd = ctx.createRadialGradient(cx, cy, 2, cx, cy, pr);
      grd.addColorStop(0, 'rgba(' + dc[0] + ',' + dc[1] + ',' + dc[2] + ',0.88)');
      grd.addColorStop(0.7, 'rgba(' + Math.round(dc[0] * 1.1) + ',' + Math.round(dc[1] * 1.05) + ',' + Math.round(dc[2] * 1.1) + ',0.6)');
      grd.addColorStop(1, 'rgba(' + dc[0] + ',' + dc[1] + ',' + dc[2] + ',0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(cx, cy, pr, 0, Math.PI * 2); ctx.fill();

      // 标记网格脏污
      const rb = (pr / DIRT_W) * GRID;
      const cu = Math.floor(u * GRID), cv = Math.floor(v * GRID);
      const r0 = Math.max(0, Math.floor(cv - rb)), r1 = Math.min(GRID - 1, Math.ceil(cv + rb));
      const c0 = Math.max(0, Math.floor(cu - rb)), c1 = Math.min(GRID - 1, Math.ceil(cu + rb));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const du = (c + 0.5) / GRID - u, dv = (r + 0.5) / GRID - v;
        if (du * du + dv * dv <= rb * rb && !S.dirtyCells[r * GRID + c]) {
          S.dirtyCells[r * GRID + c] = 1; S.totalDirty++;
        }
      }
    }
    S.dirtTex.needsUpdate = true;
  }

  function spawnTrash(cfg) {
    S.trash = [];
    const half = ROOM_SIZE / 2 - 1;
    const makers = [
      () => new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 0.42, 12),
        new T.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 })),        // 易拉罐
      () => new T.Mesh(new T.BoxGeometry(0.34, 0.06, 0.44),
        new T.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.9 })),        // 纸团
      () => new T.Mesh(new T.SphereGeometry(0.18, 12, 12),
        new T.MeshStandardMaterial({ color: 0xe67e22, roughness: 0.7 })),        // 苹果核
    ];
    for (let i = 0; i < cfg.trash; i++) {
      const m = makers[i % makers.length]();
      const x = rand(-half, half), z = rand(-half, half);
      m.position.set(x, 0.25, z); m.castShadow = true;
      m.userData = { type: 'trash', removed: false };
      S.roomGroup.add(m); S.trash.push(m);
    }
  }

  // ---------------- Cleaning ----------------
  function eraseAt(u, v, radiusWorld) {
    let newly = 0;
    const ctx = S.dirtCtx;
    const cx = u * DIRT_W, cy = (1 - v) * DIRT_H;
    const pr = (radiusWorld / ROOM_SIZE) * DIRT_W;
    ctx.globalCompositeOperation = 'destination-out';
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, pr);
    grd.addColorStop(0, 'rgba(0,0,0,1)');
    grd.addColorStop(0.7, 'rgba(0,0,0,0.9)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(cx, cy, pr, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    S.dirtTex.needsUpdate = true;

    // 网格标记
    const rb = (radiusWorld / ROOM_SIZE) * GRID;
    const cu = Math.floor(u * GRID), cv = Math.floor(v * GRID);
    const r0 = Math.max(0, Math.floor(cv - rb)), r1 = Math.min(GRID - 1, Math.ceil(cv + rb));
    const c0 = Math.max(0, Math.floor(cu - rb)), c1 = Math.min(GRID - 1, Math.ceil(cu + rb));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const du = (c + 0.5) / GRID - u, dv = (r + 0.5) / GRID - v;
      if (du * du + dv * dv <= rb * rb) {
        const idx = r * GRID + c;
        if (!S.cleanedCells[idx]) { S.cleanedCells[idx] = 1; newly++; }
      }
    }
    if (newly > 0) addCoins(newly * COIN_PER_CELL);
  }

  function computeClean() {
    if (S.totalDirty > 0) {
      let cd = 0;
      for (let i = 0; i < S.dirtyCells.length; i++)
        if (S.dirtyCells[i] && S.cleanedCells[i]) cd++;
      S.cleanFloor = cd / S.totalDirty;
    }
    S.cleanTrash = S.totalTrash ? (S.totalTrash - S.trash.length) / S.totalTrash : 1;
    const total = clamp(S.cleanFloor * W_FLOOR + S.cleanTrash * W_TRASH, 0, 1);
    const pct = Math.round(total * 100);
    document.getElementById('cleanBar').style.width = pct + '%';
    document.getElementById('cleanNum').textContent = pct + '%';
    if (total >= COMPLETE && !S.done) completeRoom();
  }

  function removeTrash(m) {
    if (m.userData.removed) return;
    m.userData.removed = true;
    S.roomGroup.remove(m);
    const idx = S.trash.indexOf(m); if (idx >= 0) S.trash.splice(idx, 1);
    burst(m.position, 0x9be7a0, 10);
    if (S.tool !== 'broom') playBlip(520); // 扫帚拾垃圾不响"滴"音,只保留刷啦声
    addCoins(COIN_PER_TRASH);
    computeClean();
  }

  function completeRoom() {
    S.done = true;
    playChime();
    burst(new T.Vector3(0, 1.5, 0), 0xffe39b, 24);
    dropRewardBoxes();
    addCoins(COMPLETE_BONUS);
    const sub = document.getElementById('bannerSub');
    sub.textContent = ROOMS[S.roomIndex].name + ' · 清洁度 ' + document.getElementById('cleanNum').textContent + ' · +' + COMPLETE_BONUS + '💰';
    document.getElementById('banner').classList.add('show');
    // 清扫干净 → 出现左下角"完成"按钮,玩家开箱布置完自己点,不再自动跳关
    document.getElementById('doneBtn').classList.add('show');
  }

  // 玩家点左下角"完成"→ 进入下一关(环形循环)
  function advanceToNext() {
    if (S.advTimer) { clearTimeout(S.advTimer); S.advTimer = null; }
    document.getElementById('banner').classList.remove('show');
    document.getElementById('doneBtn').classList.remove('show');
    const next = (S.roomIndex + 1) % ROOMS.length;
    S.roomIndex = next; buildRoom(ROOMS[next]); buildToolbar();
    document.getElementById('roomName').textContent = ROOMS[next].name;
  }

  // 清扫完成后天上掉下几个箱子(奖励,落地停留);装饰,不参与清扫
  function dropRewardBoxes() {
    const half = ROOM_SIZE / 2 - 1.5;
    const N = 4; // [PLACEHOLDER] 奖励箱子数量
    for (let i = 0; i < N; i++) {
      const s = rand(0.6, 1.0);
      const mat = new T.MeshStandardMaterial({ color: 0xc89b5a, roughness: 0.85 });
      const box = new T.Mesh(new T.BoxGeometry(s, s, s), mat);
      box.position.set(rand(-half, half), 9 + i * 1.2, rand(-half, half));
      box.rotation.set(rand(0, 0.4), rand(0, Math.PI), rand(0, 0.4));
      box.castShadow = true;
      S.roomGroup.add(box);
      S.boxes.push({ mesh: box, vy: 0, restY: s / 2, settled: false, spin: rand(-1, 1) });
    }
  }
  function updateBoxes(dt) {
    for (const b of S.boxes) {
      if (b.settled) { b.mesh.rotation.y += b.spin * dt; continue; }
      b.vy -= 18 * dt; // [PLACEHOLDER] 重力加速度
      b.mesh.position.y += b.vy * dt;
      b.mesh.rotation.x += b.spin * dt * 0.5;
      if (b.mesh.position.y <= b.restY) {
        b.mesh.position.y = b.restY;
        if (Math.abs(b.vy) > 1.2) b.vy = -b.vy * 0.35; // 轻微弹跳
        else { b.vy = 0; b.settled = true; playBlip(220); } // 落地轻响
      }
    }
  }

  // 点箱子→开箱,随机掏出 FURN_PER_BOX 件家具落到房间(收集品),呈网格散开
  function openBox(b) {
    if (b.opened) return;
    b.opened = true;
    const box = b.mesh;
    const cols = 5, rows = 2, gap = 1.0;           // 5×2 网格散开
    const lim = ROOM_SIZE / 2 - 0.9;               // 不越出房间
    const pool = FURN[ROOMS[S.roomIndex].id];
    for (let i = 0; i < FURN_PER_BOX; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      const fur = pool[idx]();
      const col = i % cols, row = Math.floor(i / cols);
      let x = box.position.x + (col - (cols - 1) / 2) * gap;
      let z = box.position.z + (row - (rows - 1) / 2) * gap;
      x = clamp(x, -lim, lim); z = clamp(z, -lim, lim);
      const ry = rand(0, Math.PI * 2);
      fur.position.set(x, 0, z);
      fur.rotation.y = ry;
      S.furnGroup.add(fur); // 加入持久层,跨关不丢
      const entry = { idx, x, z, ry, y: 0 };
      fur.userData.inv = entry;
      (S.furnByRoom[S.roomIndex] = S.furnByRoom[S.roomIndex] || []).push(entry);
      S.furn.push(fur);
      S.reveals.push({ obj: fur, t: -0.06 * i, finalY: 0 }); // 错峰弹落,依次出现
    }
    S.revealBoxes.push({ obj: box, t: 0 });
    burst(box.position.clone().setY(box.position.y + 0.4), 0xffd36b, 22);
    playChime();
  }
  // 放下家具:锅若靠近灶台→吸附到台面(写回存档 y);其余落回地面
  function dropFurniture(f) {
    if (f.userData.kind === 'pot') {
      let best = null, bd = 1e9;
      for (const s of S.furn) {
        if (!s.userData.isStove) continue;
        const d = Math.hypot(f.position.x - s.position.x, f.position.z - s.position.z);
        if (d < bd) { bd = d; best = s; }
      }
      if (best && bd < 1.4) {
        f.position.set(best.position.x, best.userData.cooktopY, best.position.z);
        if (f.userData.inv) { f.userData.inv.x = f.position.x; f.userData.inv.z = f.position.z; f.userData.inv.y = f.position.y; }
        burst(f.position.clone().setY(f.position.y + 0.3), 0x8be0ff, 8); // 吸附反馈
        return;
      }
    }
    f.position.y = 0;
    if (f.userData.inv) f.userData.inv.y = 0;
  }
  function updateReveals(dt) {
    for (let i = S.reveals.length - 1; i >= 0; i--) {
      const r = S.reveals[i];
      r.t += dt;
      const k = Math.min(1, r.t / 0.45);
      const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
      r.obj.scale.setScalar(Math.max(0.01, e));
      r.obj.position.y = r.finalY + (1 - e) * 0.6; // 从上方弹落
      if (k >= 1) { r.obj.scale.setScalar(1); r.obj.position.y = r.finalY; S.reveals.splice(i, 1); }
    }
  }
  function updateRevealBoxes(dt) {
    for (let i = S.revealBoxes.length - 1; i >= 0; i--) {
      const r = S.revealBoxes[i];
      r.t += dt;
      const k = Math.min(1, r.t / 0.35);
      r.obj.scale.setScalar(Math.max(0.001, 1 - k));
      r.obj.rotation.y += dt * 6;
      if (k >= 1) { S.roomGroup.remove(r.obj); S.revealBoxes.splice(i, 1); }
    }
  }

  // ---------------- Particles ----------------
  function burst(pos, color, n) {
    for (let i = 0; i < n; i++) {
      const mat = new T.SpriteMaterial({ map: S.softTex, color: color, transparent: true, depthWrite: false });
      const sp = new T.Sprite(mat);
      sp.position.copy(pos);
      const s = rand(0.15, 0.4); sp.scale.set(s, s, s);
      const v = new T.Vector3(rand(-1, 1), rand(0.6, 1.8), rand(-1, 1)).multiplyScalar(rand(1, 2.5));
      S.scene.add(sp);
      S.particles.push({ sp, v, life: 1 });
    }
  }

  function updateParticles(dt) {
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const p = S.particles[i];
      p.life -= dt * 1.6;
      if (p.life <= 0) { S.scene.remove(p.sp); p.sp.material.dispose(); S.particles.splice(i, 1); continue; }
      p.sp.position.addScaledVector(p.v, dt);
      p.v.y -= dt * 1.2;
      p.sp.material.opacity = p.life;
    }
  }

  // ---------------- Audio (WebAudio 合成,无外部资源) ----------------
  // 每个清扫工具一条独立声道,切换工具联动换声
  function ensureAudio() {
    if (S.audio) { if (S.audio.ctx.state === 'suspended') S.audio.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    // 共享噪声缓冲
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    function noiseSrc() { const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true; return n; }
    // 给某个增益参数接一个振荡器(用于音色摆动/颤动)
    function lfo(rate, depth, target) {
      const o = ctx.createOscillator(); o.frequency.value = rate;
      const g = ctx.createGain(); g.gain.value = depth;
      o.connect(g); g.connect(target); o.start();
    }

    // 拖把:湿软"唰唰"——低频带通 + 慢速摆动
    const mopTex = ctx.createGain(); mopTex.gain.value = 0.55;
    const mopFilt = ctx.createBiquadFilter(); mopFilt.type = 'bandpass'; mopFilt.frequency.value = 620; mopFilt.Q.value = 0.6;
    const mopEnv = ctx.createGain(); mopEnv.gain.value = 0.0;
    const mopN = noiseSrc(); mopN.connect(mopFilt); mopFilt.connect(mopTex); mopTex.connect(mopEnv); mopEnv.connect(master);
    lfo(3.2, 0.35, mopTex.gain); mopN.start();

    // 扫帚:干爽"刷刷"——高频带通 + 快速颤动
    const broomTex = ctx.createGain(); broomTex.gain.value = 0.5;
    const broomFilt = ctx.createBiquadFilter(); broomFilt.type = 'bandpass'; broomFilt.frequency.value = 2800; broomFilt.Q.value = 1.4;
    const broomEnv = ctx.createGain(); broomEnv.gain.value = 0.0;
    const broomN = noiseSrc(); broomN.connect(broomFilt); broomFilt.connect(broomTex); broomTex.connect(broomEnv); broomEnv.connect(master);
    lfo(7.5, 0.4, broomTex.gain); broomN.start();

    // 吸尘器:电机"嗡嗡"——双锯齿低频 + 噪声气流(持续不颤)
    const vacEnv = ctx.createGain(); vacEnv.gain.value = 0.0;
    const vacLP = ctx.createBiquadFilter(); vacLP.type = 'lowpass'; vacLP.frequency.value = 320;
    const vacOsc1 = ctx.createOscillator(); vacOsc1.type = 'sawtooth'; vacOsc1.frequency.value = 74;
    const vacOsc2 = ctx.createOscillator(); vacOsc2.type = 'sawtooth'; vacOsc2.frequency.value = 76; // 失谐增厚
    const vacN = noiseSrc(); const vacNlp = ctx.createBiquadFilter(); vacNlp.type = 'lowpass'; vacNlp.frequency.value = 520;
    const vacNgain = ctx.createGain(); vacNgain.gain.value = 0.25;
    vacOsc1.connect(vacLP); vacOsc2.connect(vacLP); vacN.connect(vacNlp); vacNlp.connect(vacNgain); vacNgain.connect(vacLP);
    vacLP.connect(vacEnv); vacEnv.connect(master);
    lfo(5.5, 1.5, vacOsc1.frequency); // 轻微抖频
    vacOsc1.start(); vacOsc2.start(); vacN.start();

    S.audio = { ctx, master, channels: { mop: mopEnv, broom: broomEnv, vacuum: vacEnv }, active: null };
    switchToolAudio();
  }
  // 切换工具→切换发声声道(全部归零后只提升当前通道)
  function switchToolAudio() {
    if (!S.audio) return;
    const t = S.audio.ctx.currentTime;
    Object.values(S.audio.channels).forEach(g => g.gain.setTargetAtTime(0, t, 0.04));
    S.audio.active = S.tool;
    if (S.brushing) scrubOn();
  }
  function scrubOn() {
    if (!S.audio) return;
    const g = S.audio.channels[S.audio.active];
    if (g) g.gain.setTargetAtTime(0.09, S.audio.ctx.currentTime, 0.05);
  }
  function scrubOff() {
    if (!S.audio) return;
    const g = S.audio.channels[S.audio.active];
    if (g) g.gain.setTargetAtTime(0.0, S.audio.ctx.currentTime, 0.08);
  }
  function playBlip(freq) {
    if (!S.audio) return;
    const o = S.audio.ctx.createOscillator(), g = S.audio.ctx.createGain();
    o.frequency.value = freq; o.type = 'triangle';
    g.gain.setValueAtTime(0.18, S.audio.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, S.audio.ctx.currentTime + 0.18);
    o.connect(g); g.connect(S.audio.master); o.start(); o.stop(S.audio.ctx.currentTime + 0.2);
  }
  function playChime() {
    if (!S.audio) return;
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => playBlip(f), i * 110));
  }

  // ---------------- Pointer ----------------
  // 归一化坐标(TouchEvent 无 clientX,统一从 touches[0]/changedTouches[0] 取)
  function evtXY(e) {
    if (e.touches && e.touches[0]) return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches[0]) return { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY };
    return { clientX: e.clientX, clientY: e.clientY };
  }
  function ndc(e) {
    const p = evtXY(e);
    const r = S.renderer.domElement.getBoundingClientRect();
    return new T.Vector2(((p.clientX - r.left) / r.width) * 2 - 1, -((p.clientY - r.top) / r.height) * 2 + 1);
  }

  function handleMove(e) {
    if (!S.started) return;
    if (S.twoFinger) { orbitFromTouch(e); return; }
    // 优先:拖动家具(自由布置)——命中家具则只移动它,不擦地
    if (S.furnDragging) {
      S.ray.setFromCamera(ndc(e), S.camera);
      const pt = new T.Vector3();
      if (S.ray.ray.intersectPlane(S.floorPlane, pt)) {
        const half = ROOM_SIZE / 2 - 0.6;
        const hx = clamp(pt.x, -half, half), hz = clamp(pt.z, -half, half);
        S.furnDragging.position.x = hx;
        S.furnDragging.position.z = hz;
        S.furnDragging.position.y = 0.15; // 拿起一点做反馈
        if (S.furnDragging.userData.inv) { S.furnDragging.userData.inv.x = hx; S.furnDragging.userData.inv.z = hz; }
      }
      return;
    }
    const p = ndc(e);
    S.ray.setFromCamera(p, S.camera);
    // 擦地(命中地板)
    const floorHit = S.ray.intersectObject(S.floor, false)[0];
    if (!floorHit) return;
    const uv = floorHit.uv;
    const tool = TOOLS[S.tool];
    const r = toolRadius(S.tool); // 含升级放大
    eraseAt(uv.x, uv.y, r);
    if (tool.pick) {
      // 吸尘/扫帚:接触垃圾即清除
      for (let i = S.trash.length - 1; i >= 0; i--) {
        const m = S.trash[i];
        if (m.position.distanceTo(floorHit.point) < r) removeTrash(m);
      }
    }
    // 擦地反馈
    S.brushing = true; scrubOn();
    if (Math.random() < 0.25) burst(floorHit.point.clone().setY(0.2), 0xcfc2a8, 2);
    computeClean();
  }

  // 命中已开箱的家具,返回其顶层 Group(用于拖动)
  function pickFurniture(e) {
    S.ray.setFromCamera(ndc(e), S.camera);
    const hits = S.ray.intersectObjects(S.furn, true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && !S.furn.includes(o)) o = o.parent;
    return o || null;
  }

  // 轻点家具 → 向左旋转 22.5°(逆时针),写回存档跨关保持
  function rotateFurniture(f) {
    f.rotation.y -= Math.PI / 8;
    if (f.userData.inv) f.userData.inv.ry = f.rotation.y;
    playBlip(330);
    burst(f.position.clone().setY(0.6), 0xffd36b, 6);
  }

  // 长按家具 → 进入布置(拖拽)模式
  function startFurnLongPress(f) {
    S.longPressT = null;
    S.furnDragging = f;
    scrubOff();
  }

  // 机关:窗帘开合(点窗户)
  function toggleCurtain(w) {
    w.open = !w.open;
    playBlip(w.open ? 200 : 150);
  }
  // 机关:吊灯开关(点灯泡/灯罩)
  function toggleLamp() {
    if (!S.lamp) return;
    S.lamp.on = !S.lamp.on;
    playBlip(S.lamp.on ? 520 : 260);
  }
  // 机关动画(挂主循环):窗帘滑移 + 灯渐亮渐灭
  function updateMechanisms(dt) {
    const k = Math.min(1, dt * 8);
    for (const w of S.windows) {
      for (const c of w.curtains) {
        const tx = w.open ? c.userData.openX : c.userData.closedX;
        c.position.x += (tx - c.position.x) * k;
      }
    }
    if (S.lamp) {
      const b = S.lamp.bulb.material;
      const ti = S.lamp.on ? 0.9 : 0.06;
      const li = S.lamp.on ? 0.6 : 0.0; // [PLACEHOLDER] 与吊灯点光源强度一致
      b.emissiveIntensity += (ti - b.emissiveIntensity) * k;
      S.lamp.light.intensity += (li - S.lamp.light.intensity) * k;
    }
  }

  function handleTap(e) {
    if (!S.started) return;
    const p = ndc(e);
    S.ray.setFromCamera(p, S.camera);
    // 1) 箱子(开箱)
    const boxMeshes = S.boxes.filter(b => !b.opened).map(b => b.mesh);
    if (boxMeshes.length) {
      const bh = S.ray.intersectObjects(boxMeshes, false)[0];
      if (bh) { const b = S.boxes.find(x => x.mesh === bh.object); if (b) { openBox(b); return; } }
    }
    // 2) 机关:吊灯开关(点灯泡/灯罩)
    if (S.lamp && S.lamp.hit.length) {
      const lh = S.ray.intersectObjects(S.lamp.hit, false)[0];
      if (lh) { toggleLamp(); return; }
    }
    // 3) 机关:窗帘开合(点窗户玻璃/窗帘)
    for (const w of S.windows) {
      const wh = S.ray.intersectObjects(w.hit, false)[0];
      if (wh) { toggleCurtain(w); return; }
    }
    // 4) 拾垃圾
    const hit = S.ray.intersectObjects(S.trash, false)[0];
    if (hit) removeTrash(hit.object);
  }

  function orbitFromTouch(e) {
    if (e.touches && e.touches.length >= 2) {
      const a = e.touches[0], b = e.touches[1];
      const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
      if (S.lastTouch) {
        const dx = mx - S.lastTouch.x, dy = my - S.lastTouch.y;
        S.cam.theta -= dx * 0.006;
        S.cam.phi = clamp(S.cam.phi - dy * 0.006, 0.15, Math.PI / 2 - 0.05);
        updateCamera();
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (S.lastDist) { S.cam.r = clamp(S.cam.r - (dist - S.lastDist) * 0.02, 8, 26); updateCamera(); }
        S.lastDist = dist;
      }
      S.lastTouch = { x: mx, y: my };
    }
  }

  // 事件绑定
  function bindInput() {
    const el = S.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault()); // 桌面右键拖动转视角时,屏蔽浏览器右键菜单抢手势
    const LONG_PRESS = 300; // [PLACEHOLDER] 长按进入布置的阈值(ms)
    function cancelLongPress() { if (S.longPressT) { clearTimeout(S.longPressT); S.longPressT = null; } }

    let touchMoved = false, tsx = 0, tsy = 0, tst = 0; // 触屏轻点判定
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length >= 2) {
        e.preventDefault(); // 双指按下即吞掉浏览器默认手势(缩放/滚动),保证转视角稳定
        S.twoFinger = true; S.lastTouch = null; S.lastDist = null; scrubOff();
        cancelLongPress(); S.furnPending = null; S.furnDragging = null; return;
      }
      S.twoFinger = false;
      touchMoved = false;
      tsx = e.touches[0].clientX; tsy = e.touches[0].clientY; tst = performance.now();
      cancelLongPress(); S.furnPending = null;
      const f = pickFurniture(e.touches[0]);
      if (f) { S.furnPending = f; S.longPressT = setTimeout(() => startFurnLongPress(f), LONG_PRESS); } // 长按=布置
    }, { passive: false });
    el.addEventListener('touchmove', (e) => {
      if (S.twoFinger) { e.preventDefault(); orbitFromTouch(e); } // 双指轻放滑动即转视角
      else {
        e.preventDefault();
        if (S.furnPending && !S.furnDragging) { cancelLongPress(); S.furnPending = null; } // 未长按就移动→取消布置,转擦地
        handleMove(e);
        if (Math.abs(e.touches[0].clientX - tsx) + Math.abs(e.touches[0].clientY - tsy) > 8) touchMoved = true;
      }
    }, { passive: false });
    el.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) {
        S.twoFinger = false; S.lastTouch = null; S.brushing = false; scrubOff();
        cancelLongPress();
        const quick = !touchMoved && (performance.now() - tst) < 400;
        const wasFurn = !!S.furnPending;
        if (S.furnPending && quick && !S.furnDragging) rotateFurniture(S.furnPending); // 碰一下=向左旋转45°
        S.furnPending = null;
        if (S.furnDragging) { dropFurniture(S.furnDragging); S.furnDragging = null; }
        if (quick && !wasFurn) handleTap(e.changedTouches[0] || e); // 开箱/机关/拾垃圾
      }
    });
    // 鼠标(桌面测试):左键擦地/轻点=旋转·机关·开箱,按住家具长按=布置,右键拖动=转视角,滚轮=缩放
    let down = false, moved = false, sx = 0, sy = 0, mouseOrbit = false;
    el.addEventListener('mousedown', (e) => {
      if (e.button === 2) { mouseOrbit = true; down = false; sx = e.clientX; sy = e.clientY; e.preventDefault(); return; }
      down = true; moved = false; sx = e.clientX; sy = e.clientY;
      cancelLongPress(); S.furnPending = null;
      const f = pickFurniture(e);
      if (f) { S.furnPending = f; S.longPressT = setTimeout(() => startFurnLongPress(f), LONG_PRESS); }
    });
    el.addEventListener('mousemove', (e) => {
      if (mouseOrbit) {
        const dx = e.clientX - sx, dy = e.clientY - sy;
        S.cam.theta -= dx * 0.006;
        S.cam.phi = clamp(S.cam.phi - dy * 0.006, 0.15, Math.PI / 2 - 0.05);
        updateCamera();
        sx = e.clientX; sy = e.clientY; return;
      }
      if (!down) return;
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 6) {
        moved = true;
        if (S.furnPending && !S.furnDragging) { cancelLongPress(); S.furnPending = null; }
      }
      handleMove(e);
    });
    el.addEventListener('mouseup', (e) => {
      if (mouseOrbit) { mouseOrbit = false; return; }
      cancelLongPress();
      const wasFurn = !!S.furnPending;
      if (down && !moved) { if (wasFurn) rotateFurniture(S.furnPending); else handleTap(e); }
      S.furnPending = null;
      if (S.furnDragging) { S.furnDragging.position.y = 0; S.furnDragging = null; }
      down = false; S.brushing = false; scrubOff();
    });
    el.addEventListener('mouseleave', () => {
      cancelLongPress(); S.furnPending = null;
      down = false; mouseOrbit = false;
      S.brushing = false; scrubOff();
      if (S.furnDragging) { S.furnDragging.position.y = 0; S.furnDragging = null; }
    });
    // 桌面滚轮缩放视距
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      S.cam.r = clamp(S.cam.r + e.deltaY * 0.02, 8, 26);
      updateCamera();
    }, { passive: false });
    window.addEventListener('blur', () => scrubOff());
  }

  // ---------------- UI ----------------
  function buildToolbar() {
    const bar = document.getElementById('toolbar'); bar.innerHTML = '';
    Object.keys(TOOLS).forEach(k => {
      const t = TOOLS[k];
      const lv = S.toolLevels[k] || 0;
      const b = document.createElement('div');
      b.className = 'tool' + (k === S.tool ? ' active' : '');
      b.innerHTML = '<span class="ic">' + t.icon + '</span>' + t.name + (lv > 0 ? ' <small>Lv.' + lv + '</small>' : '');
      b.onclick = () => { S.tool = k; buildToolbar(); switchToolAudio(); };
      bar.appendChild(b);
    });
  }

  // ---------------- 商店 ----------------
  function buildShop() {
    document.getElementById('shopCoins').textContent = Math.floor(S.coins);
    const list = document.getElementById('shopList'); list.innerHTML = '';
    Object.keys(TOOLS).forEach(k => {
      const t = TOOLS[k];
      const lv = S.toolLevels[k] || 0;
      const maxed = lv >= TOOL_MAX_LV;
      const cost = maxed ? 0 : toolCost(lv);
      const row = document.createElement('div');
      row.className = 'shop-item';
      row.innerHTML =
        '<div class="si-main"><span class="si-ic">' + t.icon + '</span>' +
        '<div><div class="si-name">' + t.name + ' <small>Lv.' + lv + '/' + TOOL_MAX_LV + '</small></div>' +
        '<div class="si-r">刷头半径 ' + toolRadius(k).toFixed(2) + (lv > 0 ? ' ↑' : '') + '</div></div></div>';
      const btn = document.createElement('button');
      btn.className = 'si-buy';
      if (maxed) { btn.textContent = '已满级'; btn.disabled = true; }
      else {
        btn.textContent = '升级 · ' + cost + '💰';
        btn.disabled = S.coins < cost;
        btn.onclick = () => {
          if (S.coins < cost) return;
          S.coins -= cost; S.toolLevels[k] = lv + 1; saveSave();
          if (document.getElementById('coinNum')) document.getElementById('coinNum').textContent = Math.floor(S.coins);
          buildShop(); buildToolbar();
        };
      }
      row.appendChild(btn);
      list.appendChild(row);
    });
  }

  // (buildRoomList 已移除:房间选择面板不再使用,改为闯关自动进下一关)

  // ---------------- Loop ----------------
  let last = performance.now();
  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
    updateParticles(dt);
    updateBoxes(dt);
    updateReveals(dt);
    updateRevealBoxes(dt);
    updateMechanisms(dt);
    if (S.brushing && Math.random() < 0.3) scrubOn();
    S.renderer.render(S.scene, S.camera);
  }

  // ---------------- Boot ----------------
  function start() {
    if (S.started) return;
    S.started = true;
    ensureAudio();
    document.getElementById('start').style.display = 'none';
  }

  function boot() {
    loadSave();
    initScene();
    buildRoom(ROOMS[0]);
    buildToolbar();
    document.getElementById('roomName').textContent = ROOMS[0].name;
    if (document.getElementById('coinNum')) document.getElementById('coinNum').textContent = Math.floor(S.coins);
    bindInput();
    document.getElementById('shopBtn').onclick = () => { buildShop(); document.getElementById('shop').classList.add('show'); };
    document.getElementById('shopClose').onclick = () => document.getElementById('shop').classList.remove('show');
    document.getElementById('doneBtn').onclick = advanceToNext;
    document.getElementById('startBtn').onclick = start;
    animate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
