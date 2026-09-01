var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// server.ts
var server_exports = {};
__export(server_exports, {
  default: () => server_default
});
module.exports = __toCommonJS(server_exports);
var import_express = __toESM(require("express"), 1);
var import_path2 = __toESM(require("path"), 1);
var import_dotenv = __toESM(require("dotenv"), 1);

// server/db/base.ts
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);

// server/security.ts
var import_crypto = __toESM(require("crypto"), 1);
var import_jsonwebtoken = __toESM(require("jsonwebtoken"), 1);
function toEnglishDigits(str = "") {
  return str.replace(/[۰-۹]/g, (d) => (d.charCodeAt(0) - 1776).toString()).replace(/[٠-٩]/g, (d) => (d.charCodeAt(0) - 1632).toString());
}
var NODE_ENV = process.env.NODE_ENV || "development";
function allowTestShortcuts() {
  if (NODE_ENV !== "production") return true;
  return process.env.ALLOW_TEST_SHORTCUTS === "true";
}
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (NODE_ENV === "production" && !allowTestShortcuts()) {
      throw new Error("FATAL: JWT_SECRET is required in production.");
    }
    return "dev-fallback-insecure-secret-key-change-in-production-32b";
  }
  if (NODE_ENV === "production" && secret.length < 32 && !allowTestShortcuts()) {
    throw new Error("FATAL: JWT_SECRET must be at least 32 characters.");
  }
  return secret;
}
function getSuperAdminIdentifier() {
  return process.env.SUPER_ADMIN_IDENTIFIER || process.env.ADMIN_PHONE || process.env.ADMIN_USERNAME || process.env.SUPER_ADMIN_PHONE || process.env.SUPER_ADMIN_EMAIL || (allowTestShortcuts() ? "admin" : "");
}
var PBKDF2_ITERATIONS = 1e5;
var PBKDF2_KEYLEN = 64;
var PBKDF2_DIGEST = "sha512";
var SALT_BYTE_SIZE = 16;
function hashPassword(password) {
  if (!password || typeof password !== "string") {
    throw new Error("Password must be a non-empty string.");
  }
  const salt = import_crypto.default.randomBytes(SALT_BYTE_SIZE).toString("hex");
  const derived = import_crypto.default.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return `${salt}:${derived.toString("hex")}`;
}
function verifyPassword(password, storedHash) {
  if (!password || !storedHash || typeof storedHash !== "string") return false;
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, originalHashHex] = parts;
  if (!salt || !originalHashHex) return false;
  try {
    const derived = import_crypto.default.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
    const a = Buffer.from(derived.toString("hex"), "utf8");
    const b = Buffer.from(originalHashHex, "utf8");
    if (a.length !== b.length) return false;
    return import_crypto.default.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
function generateToken(payload, expiresIn = "7d") {
  const secret = getJwtSecret();
  return import_jsonwebtoken.default.sign(payload, secret, { expiresIn });
}
function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  try {
    return import_jsonwebtoken.default.verify(token, getJwtSecret());
  } catch {
    return null;
  }
}
function isSuperAdminIdentifier(identifier) {
  if (!identifier || typeof identifier !== "string") return false;
  const target = getSuperAdminIdentifier();
  if (!target) return false;
  const cleanInput = toEnglishDigits(identifier).trim().toLowerCase();
  const cleanTarget = toEnglishDigits(target).trim().toLowerCase();
  const a = Buffer.from(cleanInput, "utf8");
  const b = Buffer.from(cleanTarget, "utf8");
  if (a.length !== b.length) return false;
  return import_crypto.default.timingSafeEqual(a, b);
}
var SUPER_ADMIN_PHONE = process.env.SUPER_ADMIN_PHONE || "";
var SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || "";
var SUPER_ADMIN_PASS = process.env.SUPER_ADMIN_PASS || "";
var SUPER_ADMIN_NAME = process.env.SUPER_ADMIN_NAME || "\u0641\u0631\u0645\u0627\u0646\u062F\u0647 \u0627\u0631\u0634\u062F \u0633\u0627\u0645\u0648\u0631\u0627\u06CC\u06CC";
var JWT_SECRET = process.env.JWT_SECRET || "dev-fallback-insecure-secret-key-change-in-production-32b";

// server/db/base.ts
var prisma = null;
var isPrismaAvailable = false;
function setPrismaState(client, available) {
  prisma = client;
  isPrismaAvailable = available;
}
function harmonizeDatabaseEnv() {
  const dbUrl = process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DIRECT_URL || null;
  const directUrl = process.env.POSTGRES_URL_NON_POOLING || process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || dbUrl;
  if (dbUrl) {
    if (!process.env.POSTGRES_PRISMA_URL) process.env.POSTGRES_PRISMA_URL = dbUrl;
    if (!process.env.DATABASE_URL) process.env.DATABASE_URL = dbUrl;
    if (!process.env.POSTGRES_URL_NON_POOLING && directUrl) process.env.POSTGRES_URL_NON_POOLING = directUrl;
    if (!process.env.DIRECT_URL && directUrl) process.env.DIRECT_URL = directUrl;
  }
  return dbUrl;
}
function getStorageFilePath() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return import_path.default.join("/tmp", "bushido_local_db.json");
  }
  return import_path.default.join(process.cwd(), "bushido_local_db.json");
}
var DB_FILE_PATH = getStorageFilePath();
function loadLocalStore() {
  try {
    const primaryPath = getStorageFilePath();
    if (import_fs.default.existsSync(primaryPath)) {
      const data = import_fs.default.readFileSync(primaryPath, "utf-8");
      return JSON.parse(data);
    }
    const cwdPath = import_path.default.join(process.cwd(), "bushido_local_db.json");
    if (primaryPath !== cwdPath && import_fs.default.existsSync(cwdPath)) {
      const data = import_fs.default.readFileSync(cwdPath, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
  }
  return {
    users: [],
    cycles: [],
    dailyLogs: [],
    otpCodes: [],
    subscriptions: []
  };
}
var memoryStore = loadLocalStore();
var hasWarnedReadOnly = false;
function saveLocalStore() {
  if (isPrismaAvailable && prisma) {
    return;
  }
  try {
    const filePath = getStorageFilePath();
    const dir = import_path.default.dirname(filePath);
    if (!import_fs.default.existsSync(dir)) {
      import_fs.default.mkdirSync(dir, { recursive: true });
    }
    import_fs.default.writeFileSync(filePath, JSON.stringify(memoryStore, null, 2), "utf-8");
  } catch (e) {
    if (!hasWarnedReadOnly) {
      hasWarnedReadOnly = true;
      console.warn("[Database] Local file persistence fallback active in RAM (/tmp or read-only filesystem):", e?.message || e);
    }
  }
}
function seedUserData(userId) {
  const now = /* @__PURE__ */ new Date();
  const todayIso = now.toISOString().split("T")[0];
  const addDays = (dStr, days) => {
    const [y, m, d] = dStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().split("T")[0];
  };
  const cycleStart = addDays(todayIso, -24);
  const cycleEnd = addDays(cycleStart, 89);
  const starterCycle = {
    id: `cycle-${Date.now()}-${Math.floor(Math.random() * 1e3)}`,
    userId,
    title: "\u0686\u0631\u062E\u0647 \u06F1 \u2014 \u0641\u0648\u0646\u062F\u0627\u0633\u06CC\u0648\u0646 \u0627\u0631\u0627\u062F\u0647 \u0648 \u062F\u06CC\u0633\u06CC\u067E\u0644\u06CC\u0646 \u0622\u0647\u0646\u06CC\u0646",
    startDate: cycleStart,
    endDate: cycleEnd,
    targetTheme: "\u062A\u0633\u0644\u0637 \u0628\u0631 \u0633\u062D\u0631\u062E\u06CC\u0632\u06CC\u060C \u06F1\u06F0\u06F0 \u0633\u0627\u0639\u062A \u06A9\u0627\u0631 \u0639\u0645\u06CC\u0642 \u0648 \u062B\u0628\u0627\u062A \u062F\u0631 \u0648\u0631\u0632\u0634 \u0631\u0648\u0632\u0627\u0646\u0647",
    inheritedStreak: 0,
    rules: [
      "\u0633\u0627\u0639\u062A \u0628\u06CC\u062F\u0627\u0631\u0628\u0627\u0634 \u06F5:\u06F3\u06F0 \u0635\u0628\u062D \u0628\u062F\u0648\u0646 \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u0627\u0632 \u0627\u0633\u0646\u0648\u0632",
      "\u0647\u06CC\u0686 \u0631\u0648\u0632\u06CC \u0628\u062F\u0648\u0646 \u062D\u062F\u0627\u0642\u0644 \u06F3\u06F0 \u062F\u0642\u06CC\u0642\u0647 \u0648\u0631\u0632\u0634 \u0648 \u062A\u062D\u0631\u06A9 \u0633\u067E\u0631\u06CC \u0646\u0645\u06CC\u200C\u0634\u0648\u062F",
      "\u062B\u0628\u062A \u0631\u0648\u0632\u0627\u0646\u0647 \u0628\u0644\u0627\u0641\u0627\u0635\u0644\u0647 \u0642\u0628\u0644 \u0627\u0632 \u062E\u0648\u0627\u0628 \u062F\u0631 \u0645\u06CC\u062F\u0627\u0646 \u0646\u0628\u0631\u062F",
      "\u06A9\u0627\u0644\u0628\u062F\u0634\u06A9\u0627\u0641\u06CC \u0628\u062F\u0648\u0646 \u062A\u0639\u0627\u0631\u0641 \u062F\u0631 \u0635\u0648\u0631\u062A \u0647\u0631\u06AF\u0648\u0646\u0647 \u0627\u0641\u062A"
    ],
    isArchived: false,
    reportRead: false,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const starterLogs = [];
  for (let i = 0; i <= 24; i++) {
    const logDate = addDays(cycleStart, i);
    const isToday = logDate === todayIso;
    if (isToday) {
      starterLogs.push({
        id: `log-${userId}-${logDate}`,
        userId,
        cycleId: starterCycle.id,
        date: logDate,
        wakeUp: true,
        workout: true,
        study: true,
        journal: false,
        hardTask: true,
        specialMission: true,
        notes: "\u062A\u0645\u0631\u06A9\u0632 \u0628\u0627\u0644\u0627 \u0631\u0648\u06CC \u0648\u0638\u0627\u06CC\u0641 \u0631\u0648\u0632\u0627\u0646\u0647 \u0648 \u0634\u0631\u0648\u0639 \u0639\u0627\u0644\u06CC \u0635\u0628\u062D",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    } else if (i === 18) {
      starterLogs.push({
        id: `log-${userId}-${logDate}`,
        userId,
        cycleId: starterCycle.id,
        date: logDate,
        wakeUp: true,
        workout: false,
        study: false,
        journal: true,
        hardTask: false,
        specialMission: false,
        failureReason: "\u062F\u0644\u0627\u06CC\u0644 \u0634\u062E\u0635\u06CC",
        failureTime: "\u0648\u0633\u0637 \u0631\u0648\u0632",
        autopsyNotes: "\u0633\u0641\u0631 \u06A9\u0627\u0631\u06CC \u0627\u0636\u0637\u0631\u0627\u0631\u06CC \u0648 \u0639\u062F\u0645 \u062F\u0633\u062A\u0631\u0633\u06CC \u0628\u0647 \u0627\u0645\u06A9\u0627\u0646\u0627\u062A \u0639\u0627\u062F\u06CC. \u0631\u06CC\u062A\u0645 \u0641\u0631\u06CC\u0632 \u0634\u062F.",
        countermeasure: "\u062D\u0641\u0638 \u0627\u0633\u062A\u0627\u0646\u062F\u0627\u0631\u062F\u0647\u0627\u06CC \u0630\u0647\u0646\u06CC \u0648 \u0698\u0648\u0631\u0646\u0627\u0644\u200C\u0646\u0648\u06CC\u0633\u06CC \u0634\u0628\u0627\u0646\u0647 \u062F\u0631 \u0634\u0631\u0627\u06CC\u0637 \u0628\u062D\u0631\u0627\u0646.",
        createdAt: new Date(Date.now() - (24 - i) * 864e5).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    } else if (i === 11) {
      starterLogs.push({
        id: `log-${userId}-${logDate}`,
        userId,
        cycleId: starterCycle.id,
        date: logDate,
        wakeUp: false,
        workout: true,
        study: true,
        journal: true,
        hardTask: false,
        specialMission: false,
        failureReason: "\u0648\u0642\u062A\u0645 \u0631\u0648 \u0628\u0647 \u062E\u0648\u0628\u06CC \u0645\u062F\u06CC\u0631\u06CC\u062A \u0646\u06A9\u0631\u062F\u0645",
        failureTime: "\u0622\u062E\u0631 \u0631\u0648\u0632",
        autopsyNotes: "\u0627\u062A\u0644\u0627\u0641 \u0648\u0642\u062A \u062F\u0631 \u0634\u0628\u06A9\u0647\u200C\u0647\u0627\u06CC \u0627\u062C\u062A\u0645\u0627\u0639\u06CC \u062F\u0631 \u0633\u0627\u0639\u0627\u062A \u0627\u0648\u0644\u06CC\u0647 \u0635\u0628\u062D \u0628\u0627\u0639\u062B \u0628\u0647 \u062A\u0639\u0648\u06CC\u0642 \u0627\u0641\u062A\u0627\u062F\u0646 \u06A9\u0627\u0631 \u0633\u062E\u062A \u0634\u062F.",
        countermeasure: "\u0642\u0627\u0646\u0648\u0646 \u0635\u0641\u0631 \u062F\u0633\u062A\u0631\u0633\u06CC: \u06AF\u0648\u0634\u06CC \u0642\u0628\u0644 \u0627\u0632 \u0633\u0627\u0639\u062A \u06F9 \u0635\u0628\u062D \u062F\u0631 \u0627\u062A\u0627\u0642 \u062F\u06CC\u06AF\u0631 \u0642\u0641\u0644 \u0645\u06CC\u200C\u0634\u0648\u062F.",
        aiFeedback: "\u0627\u0641\u062A \u0627\u0635\u0644\u06CC \u0646\u0627\u0634\u06CC \u0627\u0632 \u062A\u0635\u0645\u06CC\u0645\u200C\u06AF\u06CC\u0631\u06CC \u0648\u0627\u06A9\u0646\u0634\u06CC \u0628\u0647 \u062C\u0627\u06CC \u06A9\u0646\u0634\u06AF\u0631\u0627\u0646\u0647 \u0628\u0648\u062F\u0647 \u0627\u0633\u062A.",
        createdAt: new Date(Date.now() - (24 - i) * 864e5).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    } else {
      starterLogs.push({
        id: `log-${userId}-${logDate}`,
        userId,
        cycleId: starterCycle.id,
        date: logDate,
        wakeUp: true,
        workout: true,
        study: true,
        journal: true,
        hardTask: true,
        specialMission: i % 3 === 0,
        notes: i % 4 === 0 ? "\u0627\u0646\u0631\u0698\u06CC \u0648 \u062A\u0645\u0631\u06A9\u0632 \u0641\u0648\u0642\u200C\u0627\u0644\u0639\u0627\u062F\u0647. \u062A\u0633\u0644\u0637 \u06A9\u0627\u0645\u0644 \u0628\u0631 \u0632\u0645\u0627\u0646." : void 0,
        createdAt: new Date(Date.now() - (24 - i) * 864e5).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  }
  return { cycle: starterCycle, logs: starterLogs };
}
function ensureDefaultAdminAndUsers() {
  const nowStr = (/* @__PURE__ */ new Date()).toISOString();
  const nextYearStr = new Date(Date.now() + 365 * 864e5).toISOString();
  if (!SUPER_ADMIN_PASS || String(SUPER_ADMIN_PASS).trim().length < 8) {
    console.warn("[Database] SUPER_ADMIN_PASS \u062E\u0627\u0644\u06CC \u06CC\u0627 \u06A9\u0648\u062A\u0627\u0647 \u0627\u0633\u062A\u061B seed \u0627\u062F\u0645\u06CC\u0646 \u0627\u0646\u062C\u0627\u0645 \u0646\u0634\u062F.");
  }
  const adminHashedPass = SUPER_ADMIN_PASS && String(SUPER_ADMIN_PASS).trim().length >= 8 ? hashPassword(SUPER_ADMIN_PASS) : null;
  const existingAdmin = memoryStore.users.find(
    (u) => u.id === "admin-master-001" || u.phoneNumber === SUPER_ADMIN_PHONE || u.email === SUPER_ADMIN_EMAIL
  );
  if (adminHashedPass && !existingAdmin) {
    const adminUser = {
      id: "admin-master-001",
      email: SUPER_ADMIN_EMAIL || null,
      phoneNumber: SUPER_ADMIN_PHONE || null,
      name: SUPER_ADMIN_NAME,
      passwordHash: adminHashedPass,
      tier: "vip_samurai",
      isVip: true,
      isAdmin: true,
      nightOwlCutoffHour: 4,
      accentTheme: "amber",
      vipSince: nowStr,
      vipExpiresAt: nextYearStr,
      paymentRefId: "REF-ADMIN-MASTER-001",
      createdAt: nowStr,
      updatedAt: nowStr
    };
    memoryStore.users.unshift(adminUser);
    const seed = seedUserData(adminUser.id);
    memoryStore.cycles.push(seed.cycle);
    memoryStore.dailyLogs.push(...seed.logs);
  } else if (adminHashedPass && existingAdmin) {
    existingAdmin.id = "admin-master-001";
    if (SUPER_ADMIN_PHONE) existingAdmin.phoneNumber = SUPER_ADMIN_PHONE;
    if (SUPER_ADMIN_EMAIL) existingAdmin.email = SUPER_ADMIN_EMAIL;
    existingAdmin.name = SUPER_ADMIN_NAME;
    existingAdmin.passwordHash = adminHashedPass;
    existingAdmin.isAdmin = true;
    existingAdmin.isVip = true;
    existingAdmin.tier = "vip_samurai";
    if (!existingAdmin.vipExpiresAt) existingAdmin.vipExpiresAt = nextYearStr;
  }
  const testHashedPass = hashPassword("test1234");
  const existingTestUser = memoryStore.users.find(
    (u) => u.id === "test-user-001" || u.email === "test@bushido.app"
  );
  if (!existingTestUser) {
    const testUser = {
      id: "test-user-001",
      email: "test@bushido.app",
      phoneNumber: "09121111111",
      name: "\u06A9\u0627\u0631\u0628\u0631 \u0622\u0632\u0645\u0627\u06CC\u0634\u06CC \u0628\u0648\u0634\u06CC\u062F\u0648 (\u062F\u06CC\u062F \u06A9\u0627\u0631\u0628\u0631)",
      passwordHash: testHashedPass,
      tier: "free",
      isVip: false,
      isAdmin: false,
      nightOwlCutoffHour: 4,
      accentTheme: "emerald",
      vipSince: null,
      vipExpiresAt: null,
      paymentRefId: null,
      createdAt: nowStr,
      updatedAt: nowStr
    };
    memoryStore.users.push(testUser);
    const testSeed = seedUserData(testUser.id);
    memoryStore.cycles.push(testSeed.cycle);
    memoryStore.dailyLogs.push(...testSeed.logs);
  } else {
    if (!existingTestUser.passwordHash) {
      existingTestUser.passwordHash = testHashedPass;
    }
  }
  saveLocalStore();
}

// server/db/users.ts
function normalizeIdentifier(val) {
  if (!val) return "";
  const persianDigits = ["\u06F0", "\u06F1", "\u06F2", "\u06F3", "\u06F4", "\u06F5", "\u06F6", "\u06F7", "\u06F8", "\u06F9"];
  const arabicDigits = ["\u0660", "\u0661", "\u0662", "\u0663", "\u0664", "\u0665", "\u0666", "\u0667", "\u0668", "\u0669"];
  let res = val.trim().toLowerCase();
  for (let i = 0; i < 10; i++) {
    res = res.replace(new RegExp(persianDigits[i], "g"), String(i));
    res = res.replace(new RegExp(arabicDigits[i], "g"), String(i));
  }
  return res;
}
function mapPrismaUser(user) {
  if (!user) return user;
  return {
    ...user,
    vipSince: user.vipSince instanceof Date ? user.vipSince.toISOString() : user.vipSince,
    vipExpiresAt: user.vipExpiresAt instanceof Date ? user.vipExpiresAt.toISOString() : user.vipExpiresAt,
    createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : user.createdAt,
    updatedAt: user.updatedAt instanceof Date ? user.updatedAt.toISOString() : user.updatedAt
  };
}
async function findUserById(id) {
  if (isPrismaAvailable && prisma) {
    try {
      const user = await prisma.user.findUnique({
        where: { id }
      });
      if (user) return mapPrismaUser(user);
    } catch (e) {
      console.warn("[Database] Prisma findUserById failed, falling back to local store:", e);
    }
  }
  const found = memoryStore.users.find((u) => u.id === id);
  return found || null;
}
async function findUserByIdentifier(identifier) {
  const normalized = normalizeIdentifier(identifier);
  if (isPrismaAvailable && prisma) {
    try {
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: { equals: normalized, mode: "insensitive" } },
            { phoneNumber: normalized }
          ]
        }
      });
      if (user) return mapPrismaUser(user);
    } catch (e) {
      console.warn("[Database] Prisma findUserByIdentifier failed, falling back to local store:", e);
    }
  }
  const found = memoryStore.users.find(
    (u) => u.email && u.email.toLowerCase() === normalized || u.phoneNumber && u.phoneNumber === normalized
  );
  return found || null;
}
async function createUser(data) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const id = `user-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const cleanEmail = data.email ? normalizeIdentifier(data.email) : void 0;
  const cleanPhone = data.phoneNumber ? normalizeIdentifier(data.phoneNumber) : void 0;
  const isMasterAccount = isSuperAdminIdentifier(cleanEmail) || isSuperAdminIdentifier(cleanPhone);
  const isFirstUser = memoryStore.users.length === 0;
  const isAdmin = isMasterAccount ? true : data.isAdmin !== void 0 ? data.isAdmin : isFirstUser;
  const isVip = isMasterAccount ? true : Boolean(data.isVip);
  const newUser = {
    id: isMasterAccount ? "admin-master-001" : id,
    email: cleanEmail || null,
    phoneNumber: cleanPhone || null,
    name: data.name || (cleanPhone ? `\u06A9\u0627\u0631\u0628\u0631 ${cleanPhone.slice(-4)}` : cleanEmail ? cleanEmail.split("@")[0] : "\u0633\u0627\u0645\u0648\u0631\u0627\u06CC\u06CC \u062F\u06CC\u0633\u06CC\u067E\u0644\u06CC\u0646"),
    passwordHash: data.passwordHash || null,
    tier: isMasterAccount ? "vip_samurai" : data.tier || (isVip ? "vip_samurai" : "free"),
    isVip,
    isAdmin,
    nightOwlCutoffHour: 4,
    accentTheme: "amber",
    vipSince: isVip ? now : null,
    vipExpiresAt: isVip ? new Date(Date.now() + 365 * 864e5).toISOString() : null,
    paymentRefId: null,
    createdAt: now,
    updatedAt: now
  };
  if (isPrismaAvailable && prisma) {
    try {
      const created = await prisma.user.create({
        data: {
          id: newUser.id,
          email: newUser.email,
          phoneNumber: newUser.phoneNumber,
          name: newUser.name,
          passwordHash: newUser.passwordHash,
          tier: newUser.tier,
          isVip: newUser.isVip,
          isAdmin: newUser.isAdmin,
          nightOwlCutoffHour: newUser.nightOwlCutoffHour,
          accentTheme: newUser.accentTheme,
          vipSince: newUser.vipSince ? new Date(newUser.vipSince) : null,
          vipExpiresAt: newUser.vipExpiresAt ? new Date(newUser.vipExpiresAt) : null,
          paymentRefId: newUser.paymentRefId
        }
      });
      return mapPrismaUser(created);
    } catch (e) {
      console.warn("[Database] Prisma createUser failed, saving to local store:", e);
    }
  }
  memoryStore.users.push(newUser);
  const seed = seedUserData(newUser.id);
  memoryStore.cycles.push(seed.cycle);
  memoryStore.dailyLogs.push(...seed.logs);
  saveLocalStore();
  return newUser;
}
async function updateUser(id, data) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const idx = memoryStore.users.findIndex((u) => u.id === id);
  const existingUser = idx !== -1 ? memoryStore.users[idx] : null;
  const isMaster = existingUser && (isSuperAdminIdentifier(existingUser.phoneNumber) || isSuperAdminIdentifier(existingUser.email));
  const safeData = { ...data };
  if (isMaster) {
    safeData.isAdmin = true;
    safeData.isVip = true;
    safeData.tier = "vip_samurai";
  }
  if (isPrismaAvailable && prisma) {
    try {
      const prismaUpdatePayload = { ...safeData, updatedAt: /* @__PURE__ */ new Date() };
      if (prismaUpdatePayload.vipSince) {
        prismaUpdatePayload.vipSince = new Date(prismaUpdatePayload.vipSince);
      }
      if (prismaUpdatePayload.vipExpiresAt) {
        prismaUpdatePayload.vipExpiresAt = new Date(prismaUpdatePayload.vipExpiresAt);
      }
      const updated = await prisma.user.update({
        where: { id },
        data: prismaUpdatePayload
      });
      return mapPrismaUser(updated);
    } catch (e) {
      console.warn("[Database] Prisma updateUser failed, updating local store:", e);
    }
  }
  if (!existingUser) return null;
  memoryStore.users[idx] = {
    ...memoryStore.users[idx],
    ...safeData,
    updatedAt: now
  };
  saveLocalStore();
  return memoryStore.users[idx];
}
async function adminGetAllUsers() {
  if (isPrismaAvailable && prisma) {
    try {
      const list = await prisma.user.findMany({
        orderBy: { createdAt: "desc" }
      });
      return list.map(mapPrismaUser);
    } catch (e) {
      console.warn("[Database] Prisma adminGetAllUsers failed, reading local store:", e);
    }
  }
  return [...memoryStore.users].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
async function adminUpdateUser(userId, data) {
  const targetUser = await findUserById(userId);
  if (!targetUser) return null;
  const isMaster = isSuperAdminIdentifier(targetUser.phoneNumber) || isSuperAdminIdentifier(targetUser.email);
  if (isMaster && (data.isAdmin === false || data.isVip === false)) {
    throw new Error("\u062D\u0633\u0627\u0628 \u0645\u0627\u0644\u06A9 \u0648 \u0641\u0631\u0645\u0627\u0646\u062F\u0647 \u0627\u0631\u0634\u062F \u0633\u06CC\u0633\u062A\u0645 \u063A\u06CC\u0631\u0642\u0627\u0628\u0644 \u062A\u0646\u0632\u0644 \u06CC\u0627 \u0644\u063A\u0648 \u062F\u0633\u062A\u0631\u0633\u06CC \u0627\u0633\u062A.");
  }
  const nowStr = (/* @__PURE__ */ new Date()).toISOString();
  const updatePayload = {
    ...data,
    updatedAt: nowStr
  };
  if (isMaster) {
    updatePayload.isAdmin = true;
    updatePayload.isVip = true;
    updatePayload.tier = "vip_samurai";
  } else {
    if (data.isAdmin !== void 0) {
      updatePayload.isAdmin = data.isAdmin;
    }
    if (data.isVip !== void 0) {
      updatePayload.isVip = data.isVip;
      if (data.isVip) {
        updatePayload.tier = data.tier || "vip_samurai";
        updatePayload.vipSince = targetUser.vipSince || nowStr;
        const currentExpiry = targetUser.vipExpiresAt ? new Date(targetUser.vipExpiresAt).getTime() : Date.now();
        const baseTime = currentExpiry > Date.now() ? currentExpiry : Date.now();
        const extDays = typeof data.daysExtension === "number" && data.daysExtension > 0 ? data.daysExtension : 365;
        updatePayload.vipExpiresAt = new Date(baseTime + extDays * 864e5).toISOString();
      } else {
        updatePayload.tier = "free";
        updatePayload.vipExpiresAt = null;
      }
    }
  }
  return updateUser(userId, updatePayload);
}
async function adminCreateTestUser(data) {
  const rawId = data.email || data.phoneNumber || data.identifier || "";
  const cleanId = normalizeIdentifier(rawId);
  const isEmail = cleanId.includes("@");
  const user = await createUser({
    name: data.name,
    email: data.email ? normalizeIdentifier(data.email) : isEmail ? cleanId : void 0,
    phoneNumber: data.phoneNumber ? normalizeIdentifier(data.phoneNumber) : !isEmail && cleanId ? cleanId : void 0,
    isVip: data.isVip,
    isAdmin: data.isAdmin,
    tier: data.tier || (data.isVip ? "vip_samurai" : "free")
  });
  return user;
}

// server/db/cycles.ts
async function getUserCycles(userId) {
  if (isPrismaAvailable && prisma) {
    try {
      const cycles2 = await prisma.cycle.findMany({
        where: { userId },
        orderBy: { startDate: "asc" }
      });
      return cycles2.map((c) => ({
        ...c,
        rules: Array.isArray(c.rules) ? c.rules : []
      }));
    } catch (e) {
      console.warn("[Database] Prisma getUserCycles failed, checking local store:", e);
    }
  }
  let cycles = memoryStore.cycles.filter((c) => c.userId === userId);
  if (cycles.length === 0) {
    const seed = seedUserData(userId);
    memoryStore.cycles.push(seed.cycle);
    memoryStore.dailyLogs.push(...seed.logs);
    saveLocalStore();
    cycles = [seed.cycle];
  }
  return cycles.sort((a, b) => a.startDate.localeCompare(b.startDate));
}
async function createCycle(userId, data) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const newCycle = {
    id: `cycle-${Date.now()}-${Math.floor(Math.random() * 1e3)}`,
    userId,
    title: data.title,
    startDate: data.startDate,
    endDate: data.endDate,
    targetTheme: data.targetTheme || null,
    inheritedStreak: data.inheritedStreak || 0,
    rules: data.rules || [],
    isArchived: false,
    reportRead: false,
    createdAt: now,
    updatedAt: now
  };
  if (isPrismaAvailable && prisma) {
    try {
      const created = await prisma.cycle.create({
        data: {
          id: newCycle.id,
          userId: newCycle.userId,
          title: newCycle.title,
          startDate: newCycle.startDate,
          endDate: newCycle.endDate,
          targetTheme: newCycle.targetTheme,
          inheritedStreak: newCycle.inheritedStreak,
          rules: newCycle.rules,
          isArchived: newCycle.isArchived,
          reportRead: newCycle.reportRead
        }
      });
      return {
        ...created,
        rules: Array.isArray(created.rules) ? created.rules : []
      };
    } catch (e) {
      console.warn("[Database] Prisma createCycle failed, saving to local store:", e);
    }
  }
  memoryStore.cycles.push(newCycle);
  saveLocalStore();
  return newCycle;
}
async function updateCycle(userId, cycleId, data) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (isPrismaAvailable && prisma) {
    try {
      const updated = await prisma.cycle.update({
        where: { id: cycleId },
        data: {
          ...data,
          updatedAt: /* @__PURE__ */ new Date()
        }
      });
      return {
        ...updated,
        rules: Array.isArray(updated.rules) ? updated.rules : []
      };
    } catch (e) {
      console.warn("[Database] Prisma updateCycle failed, updating local store:", e);
    }
  }
  const idx = memoryStore.cycles.findIndex((c) => c.id === cycleId && c.userId === userId);
  if (idx === -1) return null;
  memoryStore.cycles[idx] = {
    ...memoryStore.cycles[idx],
    ...data,
    updatedAt: now
  };
  saveLocalStore();
  return memoryStore.cycles[idx];
}
async function deleteCycle(userId, cycleId) {
  if (isPrismaAvailable && prisma) {
    try {
      await prisma.dailyLog.deleteMany({ where: { cycleId, userId } });
      await prisma.cycle.delete({ where: { id: cycleId, userId } });
      return true;
    } catch (e) {
      console.warn("[Database] Prisma deleteCycle failed, deleting in local store:", e);
    }
  }
  const initialCycleCount = memoryStore.cycles.length;
  memoryStore.cycles = memoryStore.cycles.filter((c) => !(c.id === cycleId && c.userId === userId));
  memoryStore.dailyLogs = memoryStore.dailyLogs.filter((l) => !(l.cycleId === cycleId && l.userId === userId));
  if (memoryStore.cycles.length < initialCycleCount) {
    saveLocalStore();
    return true;
  }
  return false;
}

// server/db/logs.ts
async function getUserDailyLogs(userId, cycleId) {
  if (isPrismaAvailable && prisma) {
    try {
      const logs2 = await prisma.dailyLog.findMany({
        where: {
          userId,
          ...cycleId ? { cycleId } : {}
        },
        orderBy: { date: "asc" }
      });
      return logs2.map((l) => ({
        ...l,
        createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt,
        updatedAt: l.updatedAt instanceof Date ? l.updatedAt.toISOString() : l.updatedAt
      }));
    } catch (e) {
      console.warn("[Database] Prisma getUserDailyLogs failed, checking local store:", e);
    }
  }
  let logs = memoryStore.dailyLogs.filter((l) => l.userId === userId);
  if (cycleId) {
    logs = logs.filter((l) => l.cycleId === cycleId);
  }
  return logs.sort((a, b) => a.date.localeCompare(b.date));
}
async function upsertDailyLog(userId, data) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (isPrismaAvailable && prisma) {
    try {
      const upserted = await prisma.dailyLog.upsert({
        where: {
          userId_date: {
            userId,
            date: data.date
          }
        },
        update: {
          cycleId: data.cycleId,
          wakeUp: data.wakeUp,
          workout: data.workout,
          study: data.study,
          journal: data.journal,
          hardTask: data.hardTask,
          specialMission: data.specialMission,
          failureReason: data.failureReason,
          failureTime: data.failureTime,
          autopsyNotes: data.autopsyNotes,
          countermeasure: data.countermeasure,
          aiFeedback: data.aiFeedback,
          notes: data.notes,
          updatedAt: /* @__PURE__ */ new Date()
        },
        create: {
          id: `log-${userId}-${data.date}`,
          userId,
          cycleId: data.cycleId,
          date: data.date,
          wakeUp: data.wakeUp,
          workout: data.workout,
          study: data.study,
          journal: data.journal,
          hardTask: data.hardTask,
          specialMission: data.specialMission,
          failureReason: data.failureReason,
          failureTime: data.failureTime,
          autopsyNotes: data.autopsyNotes,
          countermeasure: data.countermeasure,
          aiFeedback: data.aiFeedback,
          notes: data.notes
        }
      });
      return {
        ...upserted,
        createdAt: upserted.createdAt instanceof Date ? upserted.createdAt.toISOString() : upserted.createdAt,
        updatedAt: upserted.updatedAt instanceof Date ? upserted.updatedAt.toISOString() : upserted.updatedAt
      };
    } catch (e) {
      console.warn("[Database] Prisma upsertDailyLog failed, falling back to local store:", e);
    }
  }
  const existingIdx = memoryStore.dailyLogs.findIndex(
    (l) => l.userId === userId && l.date === data.date
  );
  if (existingIdx >= 0) {
    memoryStore.dailyLogs[existingIdx] = {
      ...memoryStore.dailyLogs[existingIdx],
      ...data,
      updatedAt: now
    };
    saveLocalStore();
    return memoryStore.dailyLogs[existingIdx];
  } else {
    const newLog = {
      id: `log-${userId}-${data.date}`,
      userId,
      ...data,
      createdAt: now,
      updatedAt: now
    };
    memoryStore.dailyLogs.push(newLog);
    saveLocalStore();
    return newLog;
  }
}

// server/db/subscriptions.ts
async function saveOtpCode(identifier, code, userId) {
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(now.getTime() + 10 * 6e4).toISOString();
  const normalized = identifier.trim().toLowerCase();
  const otp = {
    id: `otp-${Date.now()}-${Math.floor(Math.random() * 1e3)}`,
    identifier: normalized,
    code,
    expiresAt,
    verified: false,
    userId: userId || null,
    createdAt: now.toISOString()
  };
  if (isPrismaAvailable && prisma) {
    try {
      return await prisma.otpCode.create({
        data: otp
      });
    } catch (e) {
      console.warn("[Database] Prisma saveOtpCode failed, saving to local store:", e);
    }
  }
  memoryStore.otpCodes = memoryStore.otpCodes.filter((o) => o.identifier !== normalized);
  memoryStore.otpCodes.push(otp);
  saveLocalStore();
  return otp;
}
async function verifyOtpCode(identifier, code) {
  const normalized = identifier.trim().toLowerCase();
  const nowStr = (/* @__PURE__ */ new Date()).toISOString();
  if (isPrismaAvailable && prisma) {
    try {
      const match2 = await prisma.otpCode.findFirst({
        where: {
          identifier: normalized,
          code,
          verified: false,
          expiresAt: { gt: nowStr }
        }
      });
      if (match2) {
        await prisma.otpCode.update({
          where: { id: match2.id },
          data: { verified: true }
        });
        return match2;
      }
    } catch (e) {
      console.warn("[Database] Prisma verifyOtpCode failed, checking local store:", e);
    }
  }
  const match = memoryStore.otpCodes.find(
    (o) => o.identifier === normalized && o.code === code && !o.verified && o.expiresAt > nowStr
  );
  if (match) {
    match.verified = true;
    saveLocalStore();
    return match;
  }
  return null;
}
async function createSubscriptionRecord(data) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const newSub = {
    id: `sub-${Date.now()}-${Math.floor(Math.random() * 1e3)}`,
    userId: data.userId,
    planId: data.planId,
    amount: data.amount,
    authority: data.authority,
    refId: null,
    cardPan: null,
    status: "PENDING",
    description: data.description || "\u0627\u0634\u062A\u0631\u0627\u06A9 \u0648\u06CC\u0698\u0647 \u0633\u0627\u0645\u0648\u0631\u0627\u06CC\u06CC \u062F\u06CC\u0633\u06CC\u067E\u0644\u06CC\u0646",
    expiresAt: null,
    createdAt: now,
    updatedAt: now
  };
  if (isPrismaAvailable && prisma) {
    try {
      return await prisma.subscription.create({
        data: newSub
      });
    } catch (e) {
      console.warn("[Database] Prisma createSubscriptionRecord failed, saving to local store:", e);
    }
  }
  memoryStore.subscriptions.push(newSub);
  saveLocalStore();
  return newSub;
}
async function completeSubscription(authority, refId, cardPan) {
  const nowStr = (/* @__PURE__ */ new Date()).toISOString();
  const nextYearStr = new Date(Date.now() + 365 * 864e5).toISOString();
  let sub = null;
  if (isPrismaAvailable && prisma) {
    try {
      const match = await prisma.subscription.findUnique({
        where: { authority }
      });
      if (match) {
        sub = await prisma.subscription.update({
          where: { authority },
          data: {
            status: "COMPLETED",
            refId,
            cardPan,
            expiresAt: nextYearStr,
            updatedAt: nowStr
          }
        });
      }
    } catch (e) {
      console.warn("[Database] Prisma completeSubscription failed, updating local store:", e);
    }
  }
  if (!sub) {
    const idx = memoryStore.subscriptions.findIndex((s) => s.authority === authority);
    if (idx !== -1) {
      memoryStore.subscriptions[idx] = {
        ...memoryStore.subscriptions[idx],
        status: "COMPLETED",
        refId,
        cardPan,
        expiresAt: nextYearStr,
        updatedAt: nowStr
      };
      saveLocalStore();
      sub = memoryStore.subscriptions[idx];
    }
  }
  if (sub) {
    await updateUser(sub.userId, {
      isVip: true,
      tier: "vip_samurai",
      vipSince: nowStr,
      vipExpiresAt: nextYearStr,
      paymentRefId: refId
    });
  }
  return sub;
}
async function adminGetAllSubscriptions() {
  let subs = [];
  if (isPrismaAvailable && prisma) {
    try {
      subs = await prisma.subscription.findMany({
        orderBy: { createdAt: "desc" }
      });
    } catch (e) {
      console.warn("[Database] Prisma adminGetAllSubscriptions failed, reading local store:", e);
    }
  }
  if (subs.length === 0) {
    subs = [...memoryStore.subscriptions].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
  const enriched = await Promise.all(
    subs.map(async (s) => {
      const u = await findUserById(s.userId);
      return {
        ...s,
        userName: u?.name || "\u0646\u0627\u0634\u0646\u0627\u0633",
        userEmail: u?.email || void 0,
        userPhone: u?.phoneNumber || void 0
      };
    })
  );
  return enriched;
}
async function adminGetOverviewStats() {
  const todayIso = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  if (isPrismaAvailable && prisma) {
    try {
      const [totalUsers, vipUsers2, logsToday2, completedSubs2, totalLogs, activeCycles] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isVip: true } }),
        prisma.dailyLog.findMany({ where: { date: todayIso }, select: { userId: true } }),
        prisma.subscription.findMany({ where: { status: "COMPLETED" }, select: { amount: true } }),
        prisma.dailyLog.count(),
        prisma.cycle.count({ where: { isArchived: false } })
      ]);
      const activeUserIds2 = new Set(logsToday2.map((l) => l.userId));
      const totalRevenueToman2 = completedSubs2.reduce((acc, curr) => acc + (curr.amount || 0), 0);
      return {
        totalUsers,
        vipUsers: vipUsers2,
        activeToday: activeUserIds2.size,
        totalRevenueToman: totalRevenueToman2,
        totalLogs,
        activeCycles
      };
    } catch (e) {
      console.warn("[Database] Prisma adminGetOverviewStats failed, calculating from local store:", e);
    }
  }
  const users = memoryStore.users;
  const vipUsers = users.filter((u) => u.isVip).length;
  const logsToday = memoryStore.dailyLogs.filter((l) => l.date === todayIso);
  const activeUserIds = new Set(logsToday.map((l) => l.userId));
  const completedSubs = memoryStore.subscriptions.filter((s) => s.status === "COMPLETED");
  const totalRevenueToman = completedSubs.reduce((acc, curr) => acc + (curr.amount || 0), 0);
  return {
    totalUsers: users.length,
    vipUsers,
    activeToday: activeUserIds.size,
    totalRevenueToman,
    totalLogs: memoryStore.dailyLogs.length,
    activeCycles: memoryStore.cycles.filter((c) => !c.isArchived).length
  };
}

// server/db/index.ts
var prisma2 = null;
var isPrismaAvailable2 = false;
var NODE_ENV2 = process.env.NODE_ENV || "development";
var isAllowTest = process.env.ALLOW_TEST_SHORTCUTS === "true";
var isOnVercel = Boolean(process.env.VERCEL);
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function ensurePrismaAdmin() {
  if (!isPrismaAvailable2 || !prisma2) return;
  if (!SUPER_ADMIN_PASS || String(SUPER_ADMIN_PASS).trim().length < 8) return;
  try {
    const adminHashedPass = hashPassword(SUPER_ADMIN_PASS);
    const existing = await prisma2.user.findFirst({
      where: {
        OR: [
          { id: "admin-master-001" },
          ...SUPER_ADMIN_PHONE ? [{ phoneNumber: SUPER_ADMIN_PHONE }] : [],
          ...SUPER_ADMIN_EMAIL ? [{ email: SUPER_ADMIN_EMAIL }] : []
        ]
      }
    });
    const now = /* @__PURE__ */ new Date();
    const nextYear = new Date(Date.now() + 365 * 864e5);
    if (!existing) {
      await prisma2.user.create({
        data: {
          id: "admin-master-001",
          email: SUPER_ADMIN_EMAIL || null,
          phoneNumber: SUPER_ADMIN_PHONE || null,
          name: SUPER_ADMIN_NAME,
          passwordHash: adminHashedPass,
          tier: "vip_samurai",
          isVip: true,
          isAdmin: true,
          nightOwlCutoffHour: 4,
          accentTheme: "amber",
          vipSince: now,
          vipExpiresAt: nextYear,
          paymentRefId: "REF-ADMIN-MASTER-001"
        }
      });
      console.log("[Database] Seeded Super Admin user in PostgreSQL datasource.");
    } else {
      await prisma2.user.update({
        where: { id: existing.id },
        data: {
          passwordHash: adminHashedPass,
          isAdmin: true,
          isVip: true,
          tier: "vip_samurai",
          name: SUPER_ADMIN_NAME,
          vipExpiresAt: existing.vipExpiresAt || nextYear
        }
      });
    }
  } catch (err) {
    console.warn("[Database] ensurePrismaAdmin notice:", err?.message || err);
  }
}
async function initializeDatabase() {
  const dbConnectionString = harmonizeDatabaseEnv();
  const isLocalhost = !!dbConnectionString && (dbConnectionString.includes("localhost") || dbConnectionString.includes("127.0.0.1"));
  if (dbConnectionString && !(isOnVercel && isLocalhost)) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const mod = await import("@prisma/client");
        prisma2 = new mod.PrismaClient({
          log: ["error", "warn"]
        });
        await prisma2.$connect();
        isPrismaAvailable2 = true;
        setPrismaState(prisma2, true);
        console.log("[Database] PostgreSQL connected via Prisma datasource.");
        await ensurePrismaAdmin();
        break;
      } catch (err) {
        console.warn(`[Database] Prisma connection attempt ${attempt} notice:`, err?.message || err);
        if (prisma2) {
          try {
            await prisma2.$disconnect();
          } catch {
          }
          prisma2 = null;
        }
        setPrismaState(null, false);
        if (attempt < 2) await wait(300);
      }
    }
  } else {
    console.log("[Database] Running in self-hosted persistent file/memory database mode.");
  }
  if (!isPrismaAvailable2) {
    setPrismaState(null, false);
    try {
      loadLocalStore();
    } catch {
    }
    if (isAllowTest || isOnVercel || NODE_ENV2 !== "production") {
      ensureDefaultAdminAndUsers();
    }
  }
}
async function closeDatabase() {
  if (prisma2) {
    try {
      await prisma2.$disconnect();
    } catch {
    }
    prisma2 = null;
    isPrismaAvailable2 = false;
    setPrismaState(null, false);
  }
}

// server/auth.ts
async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        code: "UNAUTHORIZED",
        messageFa: "\u0646\u0634\u0633\u062A \u06A9\u0627\u0631\u0628\u0631\u06CC \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u0645\u062C\u062F\u062F\u0627\u064B \u0648\u0627\u0631\u062F \u0634\u0648\u06CC\u062F."
      });
    }
    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);
    if (!decoded || !decoded.userId) {
      return res.status(401).json({
        code: "INVALID_TOKEN",
        messageFa: "\u062A\u0648\u06A9\u0646 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u06CC\u0627 \u0645\u0646\u0642\u0636\u06CC \u0634\u062F\u0647 \u0627\u0633\u062A."
      });
    }
    const user = await findUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        code: "USER_NOT_FOUND",
        messageFa: "\u06A9\u0627\u0631\u0628\u0631 \u062F\u0631 \u062F\u06CC\u062A\u0627\u0628\u06CC\u0633 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F."
      });
    }
    const isMaster = isSuperAdminIdentifier(user.phoneNumber) || isSuperAdminIdentifier(user.email);
    req.user = {
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isVip: isMaster ? true : user.isVip,
      tier: isMaster ? "vip_samurai" : user.tier,
      isAdmin: isMaster ? true : Boolean(user.isAdmin)
    };
    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    res.status(401).json({
      code: "AUTH_ERROR",
      messageFa: "\u0627\u062D\u0631\u0627\u0632 \u0647\u0648\u06CC\u062A \u0628\u0627 \u062E\u0637\u0627 \u0645\u0648\u0627\u062C\u0647 \u0634\u062F."
    });
  }
}
async function adminMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        code: "UNAUTHORIZED",
        messageFa: "\u062F\u0633\u062A\u0631\u0633\u06CC \u063A\u06CC\u0631\u0645\u062C\u0627\u0632: \u0627\u0628\u062A\u062F\u0627 \u0648\u0627\u0631\u062F \u0634\u0648\u06CC\u062F."
      });
    }
    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);
    if (!decoded || !decoded.userId) {
      return res.status(401).json({
        code: "INVALID_TOKEN",
        messageFa: "\u062A\u0648\u06A9\u0646 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u06CC\u0627 \u0645\u0646\u0642\u0636\u06CC \u0634\u062F\u0647 \u0627\u0633\u062A."
      });
    }
    const user = await findUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        code: "USER_NOT_FOUND",
        messageFa: "\u062D\u0633\u0627\u0628 \u06A9\u0627\u0631\u0628\u0631\u06CC \u06CC\u0627\u0641\u062A \u0646\u0634\u062F."
      });
    }
    const isMaster = isSuperAdminIdentifier(user.phoneNumber) || isSuperAdminIdentifier(user.email);
    if (!user.isAdmin && !isMaster) {
      return res.status(403).json({
        code: "FORBIDDEN",
        messageFa: "\u062F\u0633\u062A\u0631\u0633\u06CC \u0641\u0642\u0637 \u0628\u0631\u0627\u06CC \u0645\u062F\u06CC\u0631\u0627\u0646 \u0628\u0648\u0634\u06CC\u062F\u0648 \u0645\u062C\u0627\u0632 \u0627\u0633\u062A."
      });
    }
    req.user = {
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isVip: true,
      tier: "vip_samurai",
      isAdmin: true
    };
    next();
  } catch (err) {
    console.error("Admin middleware error:", err);
    res.status(401).json({
      code: "AUTH_ERROR",
      messageFa: "\u0627\u062D\u0631\u0627\u0632 \u0647\u0648\u06CC\u062A \u0645\u062F\u06CC\u0631 \u0628\u0627 \u062E\u0637\u0627 \u0645\u0648\u0627\u062C\u0647 \u0634\u062F."
    });
  }
}
async function optionalAuthMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = verifyToken(token);
      if (decoded?.userId) {
        const user = await findUserById(decoded.userId);
        if (user) {
          const isMaster = isSuperAdminIdentifier(user.phoneNumber) || isSuperAdminIdentifier(user.email);
          req.user = {
            userId: user.id,
            email: user.email,
            phoneNumber: user.phoneNumber,
            isVip: isMaster ? true : user.isVip,
            tier: isMaster ? "vip_samurai" : user.tier,
            isAdmin: isMaster ? true : Boolean(user.isAdmin)
          };
        }
      }
    }
  } catch {
  }
  next();
}

// server/middleware/security.ts
var rateLimitStore = /* @__PURE__ */ new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 6e4);
function createRateLimiter(options) {
  const { windowMs, max, messageFa = "\u062A\u0639\u062F\u0627\u062F \u062F\u0631\u062E\u0648\u0627\u0633\u062A\u200C\u0647\u0627\u06CC \u0634\u0645\u0627 \u0628\u06CC\u0634 \u0627\u0632 \u062D\u062F \u0645\u062C\u0627\u0632 \u0627\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u06A9\u0645\u06CC \u0635\u0628\u0631 \u06A9\u0646\u06CC\u062F." } = options;
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown-ip";
    const identifier = req.body && (req.body.identifier || req.body.username || req.body.phone || req.body.email) || req.user && (req.user.userId || req.user.id) || "";
    const key = `${req.path}:${ip}:${identifier}`;
    const now = Date.now();
    const record = rateLimitStore.get(key);
    if (!record || now > record.resetTime) {
      rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }
    record.count += 1;
    if (record.count > max) {
      const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1e3);
      res.setHeader("Retry-After", retryAfterSeconds);
      res.status(429).json({
        code: "RATE_LIMIT_EXCEEDED",
        messageFa,
        message: "Too many requests, please try again later."
      });
      return;
    }
    next();
  };
}
var authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1e3,
  // 15 minutes window
  max: 10,
  // Max 10 attempts
  messageFa: "\u062A\u0644\u0627\u0634\u200C\u0647\u0627\u06CC \u0646\u0627\u0645\u0648\u0641\u0642 \u0648\u0631\u0648\u062F \u0628\u06CC\u0634 \u0627\u0632 \u062D\u062F \u0645\u062C\u0627\u0632 \u0627\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u06F1\u06F5 \u062F\u0642\u06CC\u0642\u0647 \u062F\u06CC\u06AF\u0631 \u062F\u0648\u0628\u0627\u0631\u0647 \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F."
});
var apiRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1e3,
  // 1 minute window
  max: 100
  // Max 100 requests per minute
});
function setSecurityHeaders(req, res, next) {
  const isProd2 = process.env.NODE_ENV === "production";
  const isDevOrTest = !isProd2 || process.env.ALLOW_TEST_SHORTCUTS === "true";
  if (isProd2) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  if (isDevOrTest) {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' *; frame-ancestors 'self' *;"
    );
  } else {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://*.zarinpal.com https://zarinpal.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://api.zarinpal.com https://payment.zarinpal.com https://sandbox.zarinpal.com; frame-ancestors 'self';"
    );
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.removeHeader("X-Powered-By");
  next();
}
function errorHandler(err, req, res, next) {
  const isProd2 = process.env.NODE_ENV === "production";
  const statusCode = err.statusCode || err.status || 500;
  const code = err.code || (statusCode === 500 ? "INTERNAL_SERVER_ERROR" : "API_ERROR");
  const messageFa = err.messageFa || "\u062E\u0637\u0627\u06CC\u06CC \u062F\u0631 \u067E\u0631\u062F\u0627\u0632\u0634 \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0631\u0648\u06CC \u062F\u0627\u062F.";
  const responseBody = {
    code,
    messageFa
  };
  if (!isProd2) {
    responseBody.message = err.message || "An unexpected error occurred.";
    if (err.details !== void 0) {
      responseBody.details = err.details;
    }
    responseBody.stack = err.stack;
  } else {
    if (statusCode < 500) {
      responseBody.message = err.message;
      if (err.details !== void 0) {
        responseBody.details = err.details;
      }
    } else {
      responseBody.message = "An internal server error occurred.";
    }
  }
  res.status(statusCode).json(responseBody);
}

// server/utils/validation.ts
var import_zod = require("zod");
var cleanDigits = (val) => toEnglishDigits(val ? val.trim() : "");
var dateStringSchema = import_zod.z.string().transform(cleanDigits).pipe(
  import_zod.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "\u0641\u0631\u0645\u062A \u062A\u0627\u0631\u06CC\u062E \u0628\u0627\u06CC\u062F \u0628\u0647 \u0635\u0648\u0631\u062A YYYY-MM-DD \u0628\u0627\u0634\u062F."
  })
);
var registerSchema = import_zod.z.object({
  identifier: import_zod.z.string().transform(cleanDigits).pipe(import_zod.z.string().min(3, { message: "\u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06CC\u0644 \u06CC\u0627 \u0627\u06CC\u0645\u06CC\u0644 \u0628\u0627\u06CC\u062F \u062D\u062F\u0627\u0642\u0644 \u06F3 \u06A9\u0627\u0631\u0627\u06A9\u062A\u0631 \u0628\u0627\u0634\u062F." })),
  password: import_zod.z.string().min(8, { message: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0628\u0627\u06CC\u062F \u062D\u062F\u0627\u0642\u0644 \u06F8 \u06A9\u0627\u0631\u0627\u06A9\u062A\u0631 \u0628\u0627\u0634\u062F." }),
  name: import_zod.z.string().max(80, { message: "\u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC \u062D\u062F\u0627\u06A9\u062B\u0631 \u0645\u06CC\u200C\u062A\u0648\u0627\u0646\u062F \u06F8\u06F0 \u06A9\u0627\u0631\u0627\u06A9\u062A\u0631 \u0628\u0627\u0634\u062F." }).optional(),
  email: import_zod.z.string().email({ message: "\u0641\u0631\u0645\u062A \u0627\u06CC\u0645\u06CC\u0644 \u0648\u0627\u0631\u062F \u0634\u062F\u0647 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A." }).optional().or(import_zod.z.literal("")),
  phoneNumber: import_zod.z.string().optional().transform((val) => val ? cleanDigits(val) : val)
});
var loginSchema = import_zod.z.object({
  identifier: import_zod.z.string().transform(cleanDigits).pipe(import_zod.z.string().min(1, { message: "\u0648\u0631\u0648\u062F \u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06CC\u0644 \u06CC\u0627 \u0627\u06CC\u0645\u06CC\u0644 \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." })),
  password: import_zod.z.string().min(1, { message: "\u0648\u0631\u0648\u062F \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." })
});
var otpRequestSchema = import_zod.z.object({
  identifier: import_zod.z.string().transform(cleanDigits).pipe(import_zod.z.string().min(1, { message: "\u0648\u0631\u0648\u062F \u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06CC\u0644 \u06CC\u0627 \u0627\u06CC\u0645\u06CC\u0644 \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." }))
});
var resetPasswordSchema = import_zod.z.object({
  identifier: import_zod.z.string().transform(cleanDigits).pipe(import_zod.z.string().min(1, { message: "\u0634\u0646\u0627\u0633\u0647 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." })),
  code: import_zod.z.string().transform(cleanDigits).pipe(import_zod.z.string().min(4, { message: "\u06A9\u062F \u062A\u0627\u06CC\u06CC\u062F \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." })),
  newPassword: import_zod.z.string().min(8, { message: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u062C\u062F\u06CC\u062F \u0628\u0627\u06CC\u062F \u062D\u062F\u0627\u0642\u0644 \u06F8 \u06A9\u0627\u0631\u0627\u06A9\u062A\u0631 \u0628\u0627\u0634\u062F." })
});
var createCycleSchema = import_zod.z.object({
  title: import_zod.z.string().min(1, { message: "\u0639\u0646\u0648\u0627\u0646 \u0686\u0631\u062E\u0647 \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." }).max(120, { message: "\u0639\u0646\u0648\u0627\u0646 \u0686\u0631\u062E\u0647 \u062D\u062F\u0627\u06A9\u062B\u0631 \u06F1\u06F2\u06F0 \u06A9\u0627\u0631\u0627\u06A9\u062A\u0631 \u0645\u06CC\u200C\u0628\u0627\u0634\u062F." }),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  targetTheme: import_zod.z.string().max(200).optional().nullable(),
  inheritedStreak: import_zod.z.number().int().min(0).optional().default(0),
  rules: import_zod.z.array(import_zod.z.string().max(200)).max(20).optional().default([])
});
var updateCycleSchema = import_zod.z.object({
  title: import_zod.z.string().min(1).max(120).optional(),
  targetTheme: import_zod.z.string().max(200).optional().nullable(),
  rules: import_zod.z.array(import_zod.z.string().max(200)).max(20).optional(),
  isArchived: import_zod.z.boolean().optional(),
  reportRead: import_zod.z.boolean().optional(),
  verdict: import_zod.z.any().optional()
});
var upsertDailyLogSchema = import_zod.z.object({
  cycleId: import_zod.z.string().min(1, { message: "\u0634\u0646\u0627\u0633\u0647 \u0686\u0631\u062E\u0647 \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." }),
  date: dateStringSchema,
  wakeUp: import_zod.z.boolean().default(false),
  workout: import_zod.z.boolean().default(false),
  study: import_zod.z.boolean().default(false),
  journal: import_zod.z.boolean().default(false),
  hardTask: import_zod.z.boolean().default(false),
  specialMission: import_zod.z.boolean().default(false),
  failureReason: import_zod.z.string().max(500).optional().nullable(),
  failureTime: import_zod.z.string().max(100).optional().nullable(),
  autopsyNotes: import_zod.z.string().max(2e3).optional().nullable(),
  countermeasure: import_zod.z.string().max(2e3).optional().nullable(),
  aiFeedback: import_zod.z.string().max(2e3).optional().nullable(),
  notes: import_zod.z.string().max(2e3).optional().nullable()
});
var autopsySchema = import_zod.z.object({
  date: dateStringSchema,
  missedHabits: import_zod.z.array(import_zod.z.string()).optional().default([]),
  failureReason: import_zod.z.string().max(500).optional().default(""),
  failureTime: import_zod.z.string().max(100).optional().default(""),
  userNotes: import_zod.z.string().max(2e3).optional().default("")
});
var paymentRequestSchema = import_zod.z.object({
  planId: import_zod.z.string().min(1, { message: "\u0634\u0646\u0627\u0633\u0647 \u0637\u0631\u062D \u0627\u0634\u062A\u0631\u0627\u06A9 \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." }),
  amount: import_zod.z.number().positive({ message: "\u0645\u0628\u0644\u063A \u067E\u0631\u062F\u0627\u062E\u062A \u0628\u0627\u06CC\u062F \u06CC\u06A9 \u0639\u062F\u062F \u0645\u062B\u0628\u062A \u0628\u0627\u0634\u062F." }),
  description: import_zod.z.string().max(200).optional()
});
var paymentVerifySchema = import_zod.z.object({
  authority: import_zod.z.string().transform(cleanDigits).pipe(import_zod.z.string().min(1, { message: "\u0634\u0646\u0627\u0633\u0647 \u0645\u0631\u062C\u0639 (Authority) \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." })),
  amount: import_zod.z.number().optional()
});
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const formattedErrors = result.error.flatten();
      const firstError = result.error.issues[0]?.message || "\u0627\u0637\u0644\u0627\u0639\u0627\u062A \u0648\u0631\u0648\u062F\u06CC \u0628\u0627 \u0627\u0644\u06AF\u0648\u06CC \u0627\u0633\u062A\u0627\u0646\u062F\u0627\u0631\u062F \u062A\u0637\u0627\u0628\u0642 \u0646\u062F\u0627\u0631\u062F.";
      res.status(400).json({
        code: "VALIDATION_ERROR",
        messageFa: firstError,
        message: "Invalid request body payload.",
        details: formattedErrors.fieldErrors
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

// server.ts
import_dotenv.default.config();
var app = (0, import_express.default)();
var PORT = 3e3;
var isProd = process.env.NODE_ENV === "production";
var testMode = allowTestShortcuts();
app.set("trust proxy", 1);
app.use(setSecurityHeaders);
app.use(import_express.default.json());
var isDbInitialized = false;
var dbInitPromise = null;
app.use(async (req, res, next) => {
  if (!isDbInitialized) {
    if (!dbInitPromise) {
      dbInitPromise = initializeDatabase().then(() => {
        isDbInitialized = true;
      }).catch((err) => {
        console.error("[Database Init Error]:", err);
        isDbInitialized = true;
      });
    }
    await dbInitPromise;
  }
  next();
});
app.use("/api", apiRateLimiter);
app.use("/api/auth", authRateLimiter);
app.get("/api/health", (req, res) => {
  const memory = process.memoryUsage();
  res.json({
    status: "ok",
    engine: "Bushido Discipline OS (Production Grade)",
    mode: isProd ? "production" : "development",
    version: "3.0.0",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    nodeVersion: process.version,
    memoryRssMb: Math.round(memory.rss / 1024 / 1024)
  });
});
app.post("/api/auth/register", validateBody(registerSchema), async (req, res, next) => {
  try {
    const { identifier, password, name, email, phoneNumber } = req.body;
    const rawId = identifier || email || phoneNumber;
    const cleanId = rawId.trim().toLowerCase();
    const existing = await findUserByIdentifier(cleanId);
    if (existing) {
      return res.status(400).json({
        code: "USER_EXISTS",
        messageFa: "\u06A9\u0627\u0631\u0628\u0631\u06CC \u0628\u0627 \u0627\u06CC\u0646 \u0645\u0634\u062E\u0635\u0627\u062A \u0642\u0628\u0644\u0627\u064B \u062B\u0628\u062A\u200C\u0646\u0627\u0645 \u06A9\u0631\u062F\u0647 \u0627\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u0648\u0627\u0631\u062F \u0634\u0648\u06CC\u062F."
      });
    }
    const isEmailInput = cleanId.includes("@");
    const isMaster = isSuperAdminIdentifier(cleanId);
    const hashedPassword = await hashPassword(password);
    const user = await createUser({
      email: isEmailInput ? cleanId : void 0,
      phoneNumber: !isEmailInput ? cleanId : void 0,
      name: name?.trim() || (isEmailInput ? cleanId.split("@")[0] : `\u06A9\u0627\u0631\u0628\u0631 ${cleanId.slice(-4)}`),
      passwordHash: hashedPassword,
      tier: isMaster ? "vip_samurai" : "free",
      isVip: isMaster,
      isAdmin: isMaster
    });
    const token = generateToken({
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isVip: user.isVip,
      tier: user.tier,
      isAdmin: Boolean(user.isAdmin)
    });
    if (!isProd) {
      console.log(`[Bushido Auth] User registered successfully: ${user.id}`);
    }
    res.json({
      success: true,
      message: "\u062B\u0628\u062A\u200C\u0646\u0627\u0645 \u0634\u0645\u0627 \u062F\u0631 \u0645\u0631\u0627\u0645\u200C\u0646\u0627\u0645\u0647 \u0628\u0648\u0634\u06CC\u062F\u0648 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u0646\u062C\u0627\u0645 \u0634\u062F.",
      token,
      user
    });
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/login", validateBody(loginSchema), async (req, res, next) => {
  try {
    const { identifier, password } = req.body;
    const cleanId = identifier.trim().toLowerCase();
    if (testMode) ensureDefaultAdminAndUsers();
    const isMaster = isSuperAdminIdentifier(cleanId);
    if (isMaster && SUPER_ADMIN_PASS && password === SUPER_ADMIN_PASS) {
      let masterAdmin = await findUserById("admin-master-001") || await findUserByIdentifier(SUPER_ADMIN_PHONE) || await findUserByIdentifier(SUPER_ADMIN_EMAIL);
      if (!masterAdmin) {
        const hashedPassword = await hashPassword(SUPER_ADMIN_PASS);
        masterAdmin = await createUser({
          email: SUPER_ADMIN_EMAIL,
          phoneNumber: SUPER_ADMIN_PHONE,
          name: SUPER_ADMIN_NAME,
          passwordHash: hashedPassword,
          tier: "vip_samurai",
          isVip: true,
          isAdmin: true
        });
      } else {
        masterAdmin.isAdmin = true;
        masterAdmin.isVip = true;
      }
      const token2 = generateToken({
        userId: masterAdmin.id,
        email: masterAdmin.email,
        phoneNumber: masterAdmin.phoneNumber,
        isVip: true,
        tier: "vip_samurai",
        isAdmin: true
      });
      return res.json({
        success: true,
        message: "\u0641\u0631\u0645\u0627\u0646\u062F\u0647 \u0627\u0631\u0634\u062F \u0633\u0627\u0645\u0648\u0631\u0627\u06CC\u06CC\u060C \u0648\u0631\u0648\u062F \u0628\u0647 \u0633\u0627\u0645\u0627\u0646\u0647 \u062A\u0627\u06CC\u06CC\u062F \u0634\u062F.",
        token: token2,
        user: masterAdmin
      });
    }
    let user = await findUserByIdentifier(cleanId);
    if (!user) {
      return res.status(401).json({
        code: "USER_NOT_FOUND",
        messageFa: "\u062D\u0633\u0627\u0628 \u06A9\u0627\u0631\u0628\u0631\u06CC \u06CC\u0627\u0641\u062A \u0646\u0634\u062F. \u0644\u0637\u0641\u0627\u064B \u0627\u0628\u062A\u062F\u0627 \u062B\u0628\u062A\u200C\u0646\u0627\u0645 \u0641\u0631\u0645\u0627\u06CC\u06CC\u062F."
      });
    }
    const isMatch = await verifyPassword(password, user.passwordHash || "");
    if (!isMatch) {
      return res.status(401).json({
        code: "INVALID_CREDENTIALS",
        messageFa: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0648\u0627\u0631\u062F \u0634\u062F\u0647 \u0646\u0627\u062F\u0631\u0633\u062A \u0627\u0633\u062A."
      });
    }
    const token = generateToken({
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isVip: user.isVip,
      tier: user.tier,
      isAdmin: Boolean(user.isAdmin)
    });
    res.json({ success: true, token, user });
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/forgot-password", validateBody(otpRequestSchema), async (req, res, next) => {
  try {
    const { identifier } = req.body;
    const cleanId = identifier.trim().toLowerCase();
    const user = await findUserByIdentifier(cleanId);
    if (!user) {
      return res.status(404).json({ code: "NOT_FOUND", messageFa: "\u062D\u0633\u0627\u0628 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0628\u0627 \u0627\u06CC\u0646 \u0645\u0634\u062E\u0635\u0627\u062A \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
    }
    const generatedCode = Math.floor(1e4 + Math.random() * 9e4).toString();
    await saveOtpCode(cleanId, generatedCode);
    if (!isProd) {
      console.log(`[Bushido Auth] Password Recovery OTP for ${cleanId}: [ ${generatedCode} ]`);
    }
    const responsePayload = {
      success: true,
      messageFa: `\u06A9\u062F \u062A\u0627\u06CC\u06CC\u062F \u06F5 \u0631\u0642\u0645\u06CC \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0628\u0631\u0627\u06CC ${cleanId} \u0627\u0631\u0633\u0627\u0644 \u0634\u062F.`
    };
    if (!isProd && process.env.ENABLE_OTP_DEBUG === "true") {
      responsePayload.debugCode = generatedCode;
    }
    res.json(responsePayload);
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/reset-password", validateBody(resetPasswordSchema), async (req, res, next) => {
  try {
    const { identifier, code, newPassword } = req.body;
    const cleanId = identifier.trim().toLowerCase();
    const isValid = await verifyOtpCode(cleanId, String(code));
    if (!isValid) {
      return res.status(400).json({ code: "INVALID_OTP", messageFa: "\u06A9\u062F \u062A\u0627\u06CC\u06CC\u062F \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u06CC\u0627 \u0645\u0646\u0642\u0636\u06CC \u0634\u062F\u0647 \u0627\u0633\u062A." });
    }
    const user = await findUserByIdentifier(cleanId);
    if (!user) {
      return res.status(404).json({ code: "NOT_FOUND", messageFa: "\u06A9\u0627\u0631\u0628\u0631 \u0645\u0648\u0631\u062F \u0646\u0638\u0631 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
    }
    const hashed = await hashPassword(newPassword);
    const updated = await updateUser(user.id, { passwordHash: hashed });
    const token = generateToken({
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isVip: user.isVip,
      tier: user.tier,
      isAdmin: Boolean(user.isAdmin)
    });
    res.json({
      success: true,
      messageFa: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0628\u0647\u200C\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F.",
      token,
      user: updated || user
    });
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/send-otp", validateBody(otpRequestSchema), async (req, res, next) => {
  try {
    const { identifier } = req.body;
    const cleanId = identifier.trim().toLowerCase();
    const generatedCode = Math.floor(1e4 + Math.random() * 9e4).toString();
    await saveOtpCode(cleanId, generatedCode);
    if (testMode) {
      console.log(`[Bushido Auth] OTP for ${cleanId}: [ ${generatedCode} ]`);
    }
    const responsePayload = {
      success: true,
      messageFa: `\u06A9\u062F \u062A\u0627\u06CC\u06CC\u062F \u06F5 \u0631\u0642\u0645\u06CC \u0628\u0631\u0627\u06CC ${cleanId} \u0627\u0631\u0633\u0627\u0644 \u0634\u062F.`
    };
    if (testMode && process.env.ENABLE_OTP_DEBUG === "true") {
      responsePayload.debugCode = generatedCode;
    }
    res.json(responsePayload);
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/verify-otp", async (req, res, next) => {
  try {
    const { identifier, code, name } = req.body;
    if (!identifier || !code) {
      return res.status(400).json({ code: "BAD_REQUEST", messageFa: "\u0634\u0646\u0627\u0633\u0647 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0648 \u06A9\u062F \u062A\u0627\u06CC\u06CC\u062F \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." });
    }
    const cleanId = identifier.trim().toLowerCase();
    const isValid = await verifyOtpCode(cleanId, String(code));
    if (!isValid) {
      return res.status(400).json({ code: "INVALID_OTP", messageFa: "\u06A9\u062F \u062A\u0627\u06CC\u06CC\u062F \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u06CC\u0627 \u0645\u0646\u0642\u0636\u06CC \u0634\u062F\u0647 \u0627\u0633\u062A." });
    }
    let user = await findUserByIdentifier(cleanId);
    const isMasterAdmin = isSuperAdminIdentifier(cleanId);
    if (!user) {
      const isEmail = cleanId.includes("@");
      user = await createUser({
        email: isEmail ? cleanId : void 0,
        phoneNumber: !isEmail ? cleanId : void 0,
        name: name?.trim() || (isEmail ? cleanId.split("@")[0] : `\u06A9\u0627\u0631\u0628\u0631 ${cleanId.slice(-4)}`),
        tier: isMasterAdmin ? "vip_samurai" : "free",
        isVip: isMasterAdmin,
        isAdmin: isMasterAdmin
      });
    } else if (isMasterAdmin && (!user.isAdmin || !user.isVip)) {
      const updatedMaster = await updateUser(user.id, {
        isAdmin: true,
        isVip: true,
        tier: "vip_samurai"
      });
      if (updatedMaster) user = updatedMaster;
    }
    const token = generateToken({
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isVip: user.isVip,
      tier: user.tier,
      isAdmin: Boolean(user.isAdmin)
    });
    res.json({ success: true, token, user });
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/quick-login", async (req, res, next) => {
  try {
    if (!testMode) {
      return res.status(403).json({
        code: "FORBIDDEN",
        messageFa: "\u0648\u0631\u0648\u062F \u0633\u0631\u06CC\u0639 \u0641\u0642\u0637 \u062F\u0631 \u062D\u0627\u0644\u062A \u062A\u0633\u062A \u0641\u0639\u0627\u0644 \u0627\u0633\u062A."
      });
    }
    const { role, userId } = req.body;
    ensureDefaultAdminAndUsers();
    let user = null;
    if (userId) {
      user = await findUserById(userId);
    } else if (role === "admin") {
      user = await findUserById("admin-master-001") || await findUserByIdentifier(SUPER_ADMIN_PHONE);
    } else if (role === "test_user") {
      user = await findUserById("test-user-001") || await findUserByIdentifier("test@bushido.app");
    }
    if (!user) {
      return res.status(404).json({ code: "NOT_FOUND", messageFa: "\u06A9\u0627\u0631\u0628\u0631 \u062A\u0633\u062A \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
    }
    const token = generateToken({
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isVip: user.isVip,
      tier: user.tier,
      isAdmin: Boolean(user.isAdmin)
    });
    res.json({ success: true, token, user });
  } catch (error) {
    next(error);
  }
});
app.get("/api/auth/me", authMiddleware, async (req, res, next) => {
  try {
    const user = await findUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ code: "NOT_FOUND", messageFa: "\u06A9\u0627\u0631\u0628\u0631 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
    }
    res.json({ user });
  } catch (error) {
    next(error);
  }
});
var handleProfileUpdate = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { name, nightOwlCutoffHour, accentTheme } = req.body;
    const updatePayload = {};
    if (typeof name === "string" && name.trim()) {
      updatePayload.name = name.trim().slice(0, 80);
    }
    if (typeof nightOwlCutoffHour === "number" && nightOwlCutoffHour >= 0 && nightOwlCutoffHour <= 23) {
      updatePayload.nightOwlCutoffHour = nightOwlCutoffHour;
    }
    if (typeof accentTheme === "string" && ["amber", "emerald", "crimson", "cyan"].includes(accentTheme)) {
      updatePayload.accentTheme = accentTheme;
    }
    const updated = await updateUser(userId, updatePayload);
    res.json({ user: updated });
  } catch (error) {
    next(error);
  }
};
app.put("/api/auth/profile", authMiddleware, handleProfileUpdate);
app.put("/api/user/profile", authMiddleware, handleProfileUpdate);
app.get("/api/cycles", authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const cycles = await getUserCycles(userId);
    res.json({ cycles });
  } catch (error) {
    next(error);
  }
});
app.post("/api/cycles", authMiddleware, validateBody(createCycleSchema), async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const newCycle = await createCycle(userId, req.body);
    res.json({ cycle: newCycle });
  } catch (error) {
    next(error);
  }
});
app.put("/api/cycles/:id", authMiddleware, validateBody(updateCycleSchema), async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const cycleId = req.params.id;
    const updated = await updateCycle(userId, cycleId, req.body);
    if (!updated) {
      return res.status(404).json({ code: "NOT_FOUND", messageFa: "\u0686\u0631\u062E\u0647 \u0645\u0648\u0631\u062F \u0646\u0638\u0631 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
    }
    res.json({ cycle: updated });
  } catch (error) {
    next(error);
  }
});
app.delete("/api/cycles/:id", authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const cycleId = req.params.id;
    const success = await deleteCycle(userId, cycleId);
    if (!success) {
      return res.status(404).json({ code: "NOT_FOUND", messageFa: "\u0686\u0631\u062E\u0647 \u0645\u0648\u0631\u062F \u0646\u0638\u0631 \u0628\u0631\u0627\u06CC \u062D\u0630\u0641 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
    }
    res.json({ success: true, messageFa: "\u0686\u0631\u062E\u0647 \u0648 \u06AF\u0632\u0627\u0631\u0634\u200C\u0647\u0627\u06CC \u0645\u0631\u062A\u0628\u0637 \u062D\u0630\u0641 \u0634\u062F\u0646\u062F." });
  } catch (error) {
    next(error);
  }
});
var handleUpsertDailyLog = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const log = await upsertDailyLog(userId, req.body);
    res.json({ log, success: true });
  } catch (error) {
    next(error);
  }
};
var handleGetDailyLogs = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const cycleId = typeof req.query.cycleId === "string" ? req.query.cycleId.slice(0, 100) : void 0;
    const logs = await getUserDailyLogs(userId, cycleId);
    res.json({ logs, success: true });
  } catch (error) {
    next(error);
  }
};
app.get("/api/logs", authMiddleware, handleGetDailyLogs);
app.post("/api/logs", authMiddleware, validateBody(upsertDailyLogSchema), handleUpsertDailyLog);
app.post("/api/logs/upsert", authMiddleware, validateBody(upsertDailyLogSchema), handleUpsertDailyLog);
app.get("/api/daily-logs", authMiddleware, handleGetDailyLogs);
app.post("/api/daily-logs", authMiddleware, validateBody(upsertDailyLogSchema), handleUpsertDailyLog);
app.post("/api/ai/autopsy", authMiddleware, validateBody(autopsySchema), (req, res, next) => {
  try {
    const { missedHabits, failureReason, failureTime, userNotes } = req.body;
    if (failureReason === "\u062F\u0644\u0627\u06CC\u0644 \u0634\u062E\u0635\u06CC") {
      return res.json({
        analysis: "\u062A\u0648\u0642\u0641 \u0627\u0636\u0637\u0631\u0627\u0631\u06CC \u0628\u0647 \u062F\u0644\u0627\u06CC\u0644 \u063A\u06CC\u0631\u0642\u0627\u0628\u0644 \u067E\u06CC\u0634\u200C\u0628\u06CC\u0646\u06CC \u0634\u062E\u0635\u06CC \u0631\u062E \u062F\u0627\u062F\u0647 \u0627\u0633\u062A.",
        psychologicalTrap: "\u062A\u0644\u0647 \u0633\u0631\u0632\u0646\u0634 \u0628\u06CC\u0647\u0648\u062F\u0647",
        countermeasure: "\u0642\u0627\u0646\u0648\u0646 \u0645\u0642\u0627\u0628\u0644\u0647: \u062B\u0628\u062A \u0641\u0631\u06CC\u0632 \u0648 \u0628\u0627\u0632\u06AF\u0634\u062A \u067E\u0631\u0642\u062F\u0631\u062A \u0628\u0647 \u0631\u06CC\u062A\u0645 \u0627\u0635\u0644\u06CC.",
        tacticalActionTomorrow: "\u0627\u062C\u0631\u0627\u06CC \u0628\u062F\u0648\u0646 \u062F\u0631\u0646\u06AF \u0627\u0648\u0644\u06CC\u0646 \u0641\u0648\u0646\u062F\u0627\u0633\u06CC\u0648\u0646 \u0631\u0648\u0632 \u062F\u0631 \u062B\u0627\u0646\u06CC\u0647 \u0627\u0648\u0644 \u0628\u06CC\u062F\u0627\u0631\u06CC."
      });
    }
    let trap = "\u062A\u0644\u0647 \u062A\u0648\u0647\u0645 \u06A9\u0646\u062A\u0631\u0644 \u0632\u0645\u0627\u0646";
    let analysis = "\u0639\u062F\u0645 \u0645\u0631\u0632\u0628\u0646\u062F\u06CC \u0645\u0634\u062E\u0635 \u0645\u06CC\u0627\u0646 \u0633\u0627\u0639\u0627\u062A \u062A\u0645\u0631\u06A9\u0632 \u0628\u0627\u0639\u062B \u0641\u0631\u0633\u0627\u06CC\u0634 \u0627\u0631\u0627\u062F\u0647 \u0634\u062F\u0647 \u0627\u0633\u062A.";
    let countermeasure = "\u0642\u0627\u0646\u0648\u0646 \u0645\u0642\u0627\u0628\u0644\u0647: \u0645\u0633\u062F\u0648\u062F\u0633\u0627\u0632\u06CC \u06A9\u0644\u06CC\u0647 \u0639\u0648\u0627\u0645\u0644 \u062D\u0648\u0627\u0633\u200C\u067E\u0631\u062A\u06CC.";
    let tacticalActionTomorrow = "\u062A\u0639\u06CC\u06CC\u0646 \u062F\u0642\u06CC\u0642 \u0633\u0646\u06AF\u06CC\u0646\u200C\u062A\u0631\u06CC\u0646 \u0648\u0638\u06CC\u0641\u0647 \u0641\u0631\u062F\u0627 \u0631\u0648\u06CC \u06A9\u0627\u063A\u0630.";
    if (failureTime === "\u0627\u0648\u0644 \u0631\u0648\u0632") {
      trap = "\u062A\u0644\u0647 \u0627\u06CC\u0646\u0631\u0633\u06CC \u0635\u0628\u062D\u06AF\u0627\u0647\u06CC";
      countermeasure = "\u0642\u0627\u0646\u0648\u0646 \u06F3\u06F0 \u062F\u0642\u06CC\u0642\u0647 \u0627\u0648\u0644: \u0648\u0631\u0648\u062F \u0645\u0633\u062A\u0642\u06CC\u0645 \u0628\u0647 \u0631\u0648\u062A\u06CC\u0646 \u0641\u0648\u0646\u062F\u0627\u0633\u06CC\u0648\u0646.";
    } else if (failureTime === "\u0648\u0633\u0637 \u0631\u0648\u0632") {
      trap = "\u062A\u0644\u0647 \u0627\u0641\u062A \u062F\u0648\u067E\u0627\u0645\u06CC\u0646 \u067E\u0633 \u0627\u0632 \u0638\u0647\u0631";
      countermeasure = "\u0642\u0627\u0646\u0648\u0646 \u0628\u0644\u0648\u06A9 \u0639\u0645\u06CC\u0642 \u06F9\u06F0 \u062F\u0642\u06CC\u0642\u0647\u200C\u0627\u06CC.";
    } else if (failureTime === "\u0622\u062E\u0631 \u0631\u0648\u0632") {
      trap = "\u062A\u0644\u0647 \u062A\u062E\u0644\u06CC\u0647 \u0645\u062E\u0632\u0646 \u0627\u0631\u0627\u062F\u0647";
      countermeasure = "\u0642\u0627\u0646\u0648\u0646 \u062E\u0637 \u0642\u0631\u0645\u0632 \u0633\u0627\u0639\u062A \u06F2\u06F1: \u0647\u06CC\u0686 \u0639\u0627\u062F\u062A\u06CC \u0646\u0628\u0627\u06CC\u062F \u067E\u0633 \u0627\u0632 \u06F9 \u0634\u0628 \u0628\u0645\u0627\u0646\u062F.";
    }
    if (missedHabits && missedHabits.length > 0) {
      analysis += ` \u0639\u062F\u0645 \u0627\u062C\u0631\u0627\u06CC \xAB${missedHabits.join("\u060C ")}\xBB \u0645\u0633\u062A\u0642\u06CC\u0645\u0627\u064B \u0633\u0627\u062E\u062A\u0627\u0631 \u0631\u0648\u0632 \u0631\u0627 \u062A\u0636\u0639\u06CC\u0641 \u06A9\u0631\u062F\u0647 \u0627\u0633\u062A.`;
    }
    res.json({ analysis, psychologicalTrap: trap, countermeasure, tacticalActionTomorrow });
  } catch (error) {
    next(error);
  }
});
app.post("/api/ai/coach", authMiddleware, (req, res, next) => {
  try {
    const { disciplinePercentage } = req.body;
    const pct = typeof disciplinePercentage === "number" ? disciplinePercentage : 75;
    let coachVerdict = "";
    if (pct >= 80) {
      coachVerdict = "\u062F\u0644\u0627\u0648\u0631\u060C \u0634\u0627\u062E\u0635 \u0627\u0646\u0636\u0628\u0627\u0637 \u0646\u0634\u0627\u0646\u200C\u062F\u0647\u0646\u062F\u0647 \u0634\u06A9\u0644\u200C\u06AF\u06CC\u0631\u06CC \u062F\u06CC\u0633\u06CC\u067E\u0644\u06CC\u0646 \u067E\u0648\u0644\u0627\u062F\u06CC\u0646 \u0627\u0633\u062A.";
    } else if (pct >= 60) {
      coachVerdict = "\u0639\u0645\u0644\u06A9\u0631\u062F \u0634\u0645\u0627 \u062F\u0631 \u0648\u0636\u0639\u06CC\u062A \u0627\u0646\u0636\u0628\u0627\u0637 \u067E\u0627\u06CC\u062F\u0627\u0631 \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0645\u06CC\u200C\u0634\u0648\u062F.";
    } else {
      coachVerdict = "\u0647\u0634\u062F\u0627\u0631 \u062F\u06CC\u0648\u0627\u0646 \u0628\u0648\u0634\u06CC\u062F\u0648: \u0627\u062E\u062A\u0644\u0627\u0644 \u062F\u0631 \u0633\u0627\u062E\u062A\u0627\u0631 \u062A\u0639\u0647\u062F\u0627\u062A \u0645\u0634\u0627\u0647\u062F\u0647 \u0645\u06CC\u200C\u0634\u0648\u062F.";
    }
    res.json({
      coachVerdict,
      keyAdvice: "\u0631\u0648\u06CC \u0633\u0627\u0639\u062A \u0637\u0644\u0627\u06CC\u06CC \u0634\u0631\u0648\u0639 \u0631\u0648\u0632 \u062A\u0645\u0631\u06A9\u0632 \u06A9\u0646.",
      strategicWarning: "\u0628\u062F\u0647\u06CC\u200C\u0647\u0627\u06CC \u062D\u0644\u200C\u0646\u0634\u062F\u0647 \u0627\u0646\u0631\u0698\u06CC \u0631\u0648\u0627\u0646\u06CC \u0631\u0627 \u0645\u06CC\u200C\u0628\u0644\u0639\u0646\u062F.",
      bushidoQuote: "\u0631\u0627\u0647 \u0633\u0627\u0645\u0648\u0631\u0627\u06CC\u06CC \u062F\u0631 \u067E\u0627\u06CC\u0628\u0646\u062F\u06CC \u0628\u06CC\u200C\u0686\u0648\u0646\u200C\u0648\u0686\u0631\u0627 \u0628\u0647 \u0639\u0647\u062F \u062E\u0648\u06CC\u0634 \u0627\u0633\u062A."
    });
  } catch (error) {
    next(error);
  }
});
app.post("/api/ai/verdict", authMiddleware, (req, res, next) => {
  try {
    const { disciplinePercentage, cycleTitle } = req.body;
    const pct = typeof disciplinePercentage === "number" ? disciplinePercentage : 70;
    let grade = "B";
    let verdict = "";
    if (pct >= 85) grade = "A+";
    else if (pct >= 70) grade = "A";
    else if (pct >= 50) grade = "B";
    else grade = "C";
    verdict = `\u062F\u06CC\u0648\u0627\u0646 \u0639\u0627\u0644\u06CC \u0628\u0648\u0634\u06CC\u062F\u0648 \u0686\u0631\u062E\u0647 \xAB${cycleTitle || "\u0646\u0628\u0631\u062F"}\xBB \u0631\u0627 \u0628\u0627 \u0634\u0627\u062E\u0635 ${pct}\u066A \u062F\u0631 \u0631\u062A\u0628\u0647 ${grade} \u062A\u0627\u06CC\u06CC\u062F \u0645\u06CC\u200C\u06A9\u0646\u062F.`;
    res.json({
      verdict,
      grade,
      senseiNotes: "\u0633\u0627\u062E\u062A\u0627\u0631 \u0631\u0648\u0632\u0627\u0646\u0647 \u062A\u062B\u0628\u06CC\u062A \u0634\u062F\u0647 \u0627\u0633\u062A.",
      strengths: ["\u067E\u0627\u06CC\u062F\u0627\u0631\u06CC \u062F\u0631 \u0634\u0631\u0648\u0639 \u0631\u0648\u0632", "\u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0645\u0648\u062B\u0631"],
      weaknesses: ["\u0646\u0648\u0633\u0627\u0646 \u0645\u0642\u0637\u0639\u06CC"],
      tacticalPlanForNextCycle: "\u062A\u062B\u0628\u06CC\u062A \u0631\u0648\u0632\u0647\u0627\u06CC \u0627\u0633\u062A\u0627\u0646\u062F\u0627\u0631\u062F."
    });
  } catch (error) {
    next(error);
  }
});
app.post("/api/payment/request", optionalAuthMiddleware, validateBody(paymentRequestSchema), async (req, res, next) => {
  try {
    const { planId, amount, description } = req.body;
    const userId = req.user?.userId || "guest-warrior-1";
    const merchantId = process.env.ZARINPAL_MERCHANT_ID?.trim();
    const isLiveZarinpal = merchantId && merchantId.length >= 30;
    const authority = "A" + Date.now().toString() + Math.floor(Math.random() * 1e3).toString().padStart(4, "0");
    await createSubscriptionRecord({
      userId,
      planId,
      amount,
      authority,
      description: description || "\u0627\u0631\u062A\u0642\u0627 \u0628\u0647 \u062D\u0633\u0627\u0628 \u0633\u0627\u0645\u0648\u0631\u0627\u06CC\u06CC \u0648\u06CC\u0698\u0647"
    });
    res.json({
      status: 100,
      authority,
      paymentUrl: `/mock-gateway?authority=${authority}&amount=${amount}`,
      amount,
      mode: isLiveZarinpal ? "zarinpal-live" : "zarinpal-mock-simulator"
    });
  } catch (error) {
    next(error);
  }
});
app.post("/api/payment/verify", validateBody(paymentVerifySchema), async (req, res, next) => {
  try {
    const { authority, amount } = req.body;
    const allSubs = await adminGetAllSubscriptions();
    const existingSub = allSubs.find((s) => s.authority === authority);
    if (existingSub && existingSub.status === "COMPLETED") {
      return res.json({
        status: 101,
        refId: existingSub.refId,
        cardPan: existingSub.cardPan,
        messageFa: "\u0627\u06CC\u0646 \u062A\u0631\u0627\u06A9\u0646\u0634 \u0642\u0628\u0644\u0627\u064B \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062B\u0628\u062A \u0648 \u062A\u0627\u06CC\u06CC\u062F \u0634\u062F\u0647 \u0627\u0633\u062A.",
        tier: "vip_samurai",
        subscription: existingSub
      });
    }
    let refId = "REF-" + Math.floor(1e7 + Math.random() * 9e7);
    let cardPan = "6037-99**-****-" + Math.floor(1e3 + Math.random() * 9e3);
    const merchantId = process.env.ZARINPAL_MERCHANT_ID?.trim();
    if (merchantId && merchantId.length >= 30) {
      const zRes = await fetch("https://api.zarinpal.com/pg/v4/payment/verify.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchant_id: merchantId, authority, amount })
      });
      const zData = await zRes.json();
      if (zData.data && (zData.data.code === 100 || zData.data.code === 101)) {
        refId = zData.data.ref_id.toString();
        cardPan = zData.data.card_pan || cardPan;
      } else {
        return res.status(400).json({
          code: "PAYMENT_FAILED",
          messageFa: "\u062A\u0631\u0627\u06A9\u0646\u0634 \u062A\u0648\u0633\u0637 \u062F\u0631\u06AF\u0627\u0647 \u0632\u0631\u06CC\u0646\u200C\u067E\u0627\u0644 \u062A\u0627\u06CC\u06CC\u062F \u0646\u0634\u062F.",
          details: zData.errors
        });
      }
    }
    const sub = await completeSubscription(authority, refId, cardPan);
    if (!sub) {
      return res.status(404).json({ code: "NOT_FOUND", messageFa: "\u0631\u06A9\u0648\u0631\u062F \u062A\u0631\u0627\u06A9\u0646\u0634 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
    }
    res.json({
      status: 100,
      refId,
      cardPan,
      authority,
      amount,
      messageFa: "\u062A\u0631\u0627\u06A9\u0646\u0634 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062A\u0627\u06CC\u06CC\u062F \u0634\u062F \u0648 \u062D\u0633\u0627\u0628 \u0634\u0645\u0627 \u0627\u0631\u062A\u0642\u0627 \u06CC\u0627\u0641\u062A.",
      tier: "vip_samurai",
      subscription: sub
    });
  } catch (error) {
    next(error);
  }
});
app.get("/api/admin/stats", adminMiddleware, async (req, res, next) => {
  try {
    const stats = await adminGetOverviewStats();
    res.json({ stats });
  } catch (error) {
    next(error);
  }
});
app.get("/api/admin/users", adminMiddleware, async (req, res, next) => {
  try {
    const users = await adminGetAllUsers();
    res.json({ users });
  } catch (error) {
    next(error);
  }
});
app.put("/api/admin/users/:id", adminMiddleware, async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { tier, isVip, isAdmin, name, daysExtension } = req.body;
    const targetUser = await findUserById(userId);
    if (!targetUser) {
      return res.status(404).json({ code: "NOT_FOUND", messageFa: "\u06A9\u0627\u0631\u0628\u0631 \u0645\u0648\u0631\u062F \u0646\u0638\u0631 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
    }
    const isTargetRootAdmin = targetUser.email === SUPER_ADMIN_EMAIL || targetUser.phoneNumber === SUPER_ADMIN_PHONE;
    if (isTargetRootAdmin && (isAdmin === false || isVip === false)) {
      return res.status(403).json({ code: "FORBIDDEN", messageFa: "\u062D\u0633\u0627\u0628 \u0645\u0627\u0644\u06A9 \u0627\u0631\u0634\u062F \u0633\u06CC\u0633\u062A\u0645 \u063A\u06CC\u0631\u0642\u0627\u0628\u0644 \u062A\u0646\u0632\u0644 \u0645\u06CC\u200C\u0628\u0627\u0634\u062F." });
    }
    const updated = await adminUpdateUser(userId, {
      tier,
      isVip: typeof isVip === "boolean" ? isVip : tier ? tier === "vip_samurai" : void 0,
      isAdmin: typeof isAdmin === "boolean" ? isAdmin : void 0,
      name,
      daysExtension: Number(daysExtension) || void 0
    });
    res.json({ user: updated, messageFa: "\u0627\u0637\u0644\u0627\u0639\u0627\u062A \u06A9\u0627\u0631\u0628\u0631 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0628\u0647\u200C\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F." });
  } catch (error) {
    next(error);
  }
});
app.post("/api/admin/users/create-test", adminMiddleware, async (req, res, next) => {
  try {
    const { name, email, phoneNumber, tier, isVip, isAdmin } = req.body;
    const user = await adminCreateTestUser({
      name: name?.trim() || "\u06A9\u0627\u0631\u0628\u0631 \u0622\u0632\u0645\u0627\u06CC\u0634\u06CC \u0628\u0648\u0634\u06CC\u062F\u0648",
      email: email?.trim() || void 0,
      phoneNumber: phoneNumber?.trim() || void 0,
      tier: tier || (isVip ? "vip_samurai" : "free"),
      isVip: Boolean(isVip || tier === "vip_samurai"),
      isAdmin: Boolean(isAdmin)
    });
    const token = generateToken({
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isVip: user.isVip,
      tier: user.tier,
      isAdmin: Boolean(user.isAdmin)
    });
    res.json({ success: true, user, token, messageFa: `\u062D\u0633\u0627\u0628 \u062C\u062F\u06CC\u062F \xAB${user.name}\xBB \u0627\u06CC\u062C\u0627\u062F \u06AF\u0631\u062F\u06CC\u062F.` });
  } catch (error) {
    next(error);
  }
});
app.post("/api/admin/impersonate", adminMiddleware, async (req, res, next) => {
  try {
    const { targetUserId } = req.body;
    const targetUser = await findUserById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ code: "NOT_FOUND", messageFa: "\u06A9\u0627\u0631\u0628\u0631 \u0645\u0648\u0631\u062F \u0646\u0638\u0631 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
    }
    const token = generateToken({
      userId: targetUser.id,
      email: targetUser.email,
      phoneNumber: targetUser.phoneNumber,
      isVip: targetUser.isVip,
      tier: targetUser.tier,
      isAdmin: Boolean(targetUser.isAdmin)
    });
    res.json({ success: true, token, user: targetUser, messageFa: `\u0634\u0628\u06CC\u0647\u200C\u0633\u0627\u0632\u06CC \u06A9\u0627\u0631\u0628\u0631 \u0641\u0639\u0627\u0644 \u0634\u062F.` });
  } catch (error) {
    next(error);
  }
});
app.get("/api/admin/subscriptions", adminMiddleware, async (req, res, next) => {
  try {
    const subscriptions = await adminGetAllSubscriptions();
    res.json({ subscriptions });
  } catch (error) {
    next(error);
  }
});
var distPath = import_path2.default.join(process.cwd(), "dist");
async function startServer() {
  await initializeDatabase();
  if (!isProd && !process.env.VERCEL) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) {
        return next();
      }
      res.sendFile(import_path2.default.join(distPath, "index.html"), (err) => {
        if (err) {
          console.error("[Static] index.html missing or unreadable:", err.message);
          res.status(404).send("UI build not found (dist/index.html). Check Vercel build logs for vite build.");
        }
      });
    });
  }
  app.use(errorHandler);
  if (!process.env.VERCEL) {
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`[Server] Bushido Discipline OS on port ${PORT}`);
    });
    const shutdown = async (signal) => {
      console.log(`[Server] ${signal} \u2014 shutting down...`);
      server.close(async () => {
        await closeDatabase();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 1e4);
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }
}
if (process.env.VERCEL) {
  initializeDatabase().catch(console.error);
  app.use(import_express.default.static(distPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    res.sendFile(import_path2.default.join(distPath, "index.html"));
  });
  app.use(errorHandler);
} else {
  startServer();
}
var server_default = app;
