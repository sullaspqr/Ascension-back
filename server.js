import express from "express";
import cors from "cors";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import mysql from "mysql2/promise";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const app = express();
app.use(
  cors({
    origin: [
      "http://localhost:5501",
      "http://127.0.0.1:5501",
      "http://localhost:5500",
      "http://127.0.0.1:5500",
    ],
    credentials: true,
  }),
);
app.use(express.json());
const upload = multer({ dest: "uploads/" });

/* ====== MYSQL KAPCSOLAT - Állítsd be a saját adataidat! ====== */
const dbConfig = {
  host: "localhost", // MySQL szerver címe
  user: "root", // MySQL felhasználónév
  password: "", // MySQL jelszó (XAMPP-ban alapból üres)
  database: "ascension_db", // Az adatbázis neve amit létrehoztál
};

// MySQL kapcsolat létrehozása és ellenőrzése
let db;
async function connectDatabase() {
  try {
    db = await mysql.createConnection(dbConfig);
    console.log("✅ MySQL kapcsolat OK - Ascension adatbázis elérhető!");

    // Táblák ellenőrzése
    const [tables] = await db.execute("SHOW TABLES LIKE 'users'");
    if (tables.length === 0) {
      console.log("⚠️  FIGYELEM: A users tábla még nem létezik!");
      console.log("💡 Futtasd le a database.sql-t phpMyAdmin-ban!");
    } else {
      console.log("✅ Users tábla megtalálva");
    }
  } catch (error) {
    console.error("❌ MySQL kapcsolat HIBA:", error.message);
    console.log("\n💡 HIBAELHÁRÍTÁS:");
    console.log("1. XAMPP/WAMP elindítva? MySQL fut?");
    console.log("2. phpMyAdmin-ban lefuttattad a database.sql-t?");
    console.log("3. Adatbázis neve: ascension_db");
    console.log("4. server.js 18-22. sor: Jók az adatok?\n");
  }
}

await connectDatabase();

const JWT_SECRET = "ascension_secret_2026";

/* ====== AUTH MIDDLEWARE ====== */
function authenticateToken(req, res, next) {
  const authHeader =
    req.headers["authorization"] || req.headers["Authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Nincs megadva hitelesítési token. Jelentkezz be újra.",
    });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error("❌ JWT verify hiba:", err.message);
      return res.status(403).json({
        success: false,
        error: "Érvénytelen vagy lejárt token. Jelentkezz be újra.",
      });
    }

    // req.user-be rakjuk a fontos adatokat
    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      email: decoded.email,
    };

    next();
  });
}

/* ====== CLOUDINARY ====== */
cloudinary.config({
  cloud_name: "dpgrckgpd",
  api_key: "971153315419944",
  api_secret: "8Il9Me1gW-ZOK-hkwjazlT_rMYM",
});

/* ====== USDA FoodData Central ====== */
const FDC_API_KEY =
  process.env.FDC_API_KEY || "dVZB801iAYTee9gse3M24mw2rYVtxkjpd2kW3jT3";

/* ====== SEGÉD ====== */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bejelentkezés
app.post("/api/auth/login", async (req, res) => {
  try {
    // Ellenőrizzük hogy van-e DB kapcsolat
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Adatbázis kapcsolat nincs! Ellenőrizd a backend-et!",
      });
    }

    const { emailOrUsername, password } = req.body;

    console.log("🔐 Login kísérlet:", emailOrUsername);

    if (!emailOrUsername || !password) {
      return res.status(400).json({
        success: false,
        error: "Email/felhasználónév és jelszó megadása kötelező",
      });
    }

    // Felhasználó keresése
    const [users] = await db.execute(
      "SELECT * FROM users WHERE email = ? OR username = ?",
      [emailOrUsername, emailOrUsername],
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        error: "Helytelen email/felhasználónév vagy jelszó",
      });
    }

    const user = users[0];

    // Jelszó ellenőrzés
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: "Helytelen email/felhasználónév vagy jelszó",
      });
    }

    console.log("✅ Login sikeres!", user.username);

    // Token
    const token = jwt.sign(
      { userId: user.id, username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.json({
      success: true,
      message: "Sikeres bejelentkezés",
      token,
      user: { id: user.id, username: user.username, email: user.email },
    });
  } catch (error) {
    console.error("❌ Login error:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

// Regisztráció
app.post("/api/auth/register", async (req, res) => {
  try {
    // Ellenőrizzük hogy van-e DB kapcsolat
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Adatbázis kapcsolat nincs! Ellenőrizd a backend-et!",
      });
    }

    const { username, email, password } = req.body;

    console.log("📝 Regisztráció kísérlet:", { username, email });

    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ success: false, error: "Minden mező megadása kötelező" });
    }

    // Ellenőrizzük, hogy létezik-e már a felhasználónév vagy email
    const [existingUsers] = await db.execute(
      "SELECT * FROM users WHERE username = ? OR email = ?",
      [username, email],
    );

    if (existingUsers.length > 0) {
      const existingUser = existingUsers[0];
      if (existingUser.username === username) {
        return res
          .status(409)
          .json({ success: false, error: "Ez a felhasználónév már foglalt" });
      }
      if (existingUser.email === email) {
        return res.status(409).json({
          success: false,
          error: "Ez az email cím már regisztrálva van",
        });
      }
    }

    // Jelszó hash-elése
    const hashedPassword = await bcrypt.hash(password, 10);

    // Új felhasználó létrehozása
    const [result] = await db.execute(
      "INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, NOW())",
      [username, email, hashedPassword],
    );

    console.log("✅ Regisztráció sikeres!", username);

    // Token generálása
    const token = jwt.sign(
      { userId: result.insertId, username, email },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.json({
      success: true,
      message: "Sikeres regisztráció",
      token,
      user: { id: result.insertId, username, email },
    });
  } catch (error) {
    console.error("❌ Regisztrációs hiba:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

/* ====== PROFILE ENDPOINT ====== */

// Profil adatok lekérése (felhasználó + statisztikák + személyes adatok)
app.get("/api/profile", authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Adatbázis kapcsolat nincs!",
      });
    }

    const userId = req.user.userId;
    console.log("👤 Profil lekérés:", userId);

    // 1. Felhasználó alapadatok lekérése
    const [users] = await db.execute(
      "SELECT id, username, email, created_at FROM users WHERE id = ?",
      [userId],
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Felhasználó nem található",
      });
    }

    const user = users[0];

    // 2. Személyes adatok lekérése (ha vannak mentve)
    let personal = null;
    try {
      const [personalRows] = await db.execute(
        `
        SELECT 
          age,
          weight_kg,
          height_cm,
          gender,
          activity_multiplier,
          goal,
          experience,
          updated_at
        FROM user_profile
        WHERE user_id = ?
      `,
        [userId],
      );

      if (personalRows.length > 0) {
        const p = personalRows[0];
        personal = {
          age: p.age,
          weightKg: p.weight_kg,
          heightCm: p.height_cm,
          gender: p.gender,
          activityMultiplier: p.activity_multiplier,
          goal: p.goal,
          experience: p.experience,
          updatedAt: p.updated_at,
        };
      }
    } catch (personalErr) {
      console.error("❌ Személyes profil adatok lekérési hiba:", personalErr);
    }

    // (Alkohol statisztikák eltávolítva)

    // 6. ÉTEL - Heti statisztikák (ez a hét)
    const [foodWeekStats] = await db.execute(
      `
      SELECT 
        COUNT(*) as entries,
        COALESCE(SUM(calories), 0) as total_calories,
        COALESCE(SUM(protein_g), 0) as total_protein,
        COALESCE(SUM(carbs_g), 0) as total_carbs
      FROM food_entries 
      WHERE user_id = ? 
      AND YEARWEEK(date, 1) = YEARWEEK(CURDATE(), 1)
    `,
      [userId],
    );

    // 7. ÉTEL - Havi statisztikák (ez a hónap)
    const [foodMonthStats] = await db.execute(
      `
      SELECT 
        COUNT(*) as entries,
        COALESCE(SUM(calories), 0) as total_calories,
        COALESCE(SUM(protein_g), 0) as total_protein,
        COALESCE(SUM(carbs_g), 0) as total_carbs
      FROM food_entries 
      WHERE user_id = ? 
      AND YEAR(date) = YEAR(CURDATE())
      AND MONTH(date) = MONTH(CURDATE())
    `,
      [userId],
    );

    // 8. ÉTEL - Összes statisztika
    const [foodTotalStats] = await db.execute(
      `
      SELECT 
        COUNT(*) as entries,
        COALESCE(SUM(calories), 0) as total_calories,
        COALESCE(SUM(protein_g), 0) as total_protein,
        COALESCE(SUM(carbs_g), 0) as total_carbs
      FROM food_entries 
      WHERE user_id = ?
    `,
      [userId],
    );

    // 9. ÉTEL - Legutóbbi 5 bejegyzés
    const [recentFoodEntries] = await db.execute(
      `
      SELECT 
        id,
        food_name,
        grams,
        calories,
        protein_g,
        carbs_g,
        date,
        created_at
      FROM food_entries 
      WHERE user_id = ?
      ORDER BY date DESC, created_at DESC
      LIMIT 5
    `,
      [userId],
    );

    // 10. EDZÉS - Heti statisztikák (ez a hét)
    const [workoutWeekStats] = await db.execute(
      `
      SELECT 
        COUNT(*) as entries,
        COALESCE(SUM(duration_minutes), 0) as total_duration,
        COALESCE(SUM(calories_burned), 0) as total_calories,
        COALESCE(SUM(sets), 0) as total_sets
      FROM workout_entries 
      WHERE user_id = ? 
      AND YEARWEEK(date, 1) = YEARWEEK(CURDATE(), 1)
    `,
      [userId],
    );

    // 11. EDZÉS - Havi statisztikák (ez a hónap)
    const [workoutMonthStats] = await db.execute(
      `
      SELECT 
        COUNT(*) as entries,
        COALESCE(SUM(duration_minutes), 0) as total_duration,
        COALESCE(SUM(calories_burned), 0) as total_calories,
        COALESCE(SUM(sets), 0) as total_sets
      FROM workout_entries 
      WHERE user_id = ? 
      AND YEAR(date) = YEAR(CURDATE())
      AND MONTH(date) = MONTH(CURDATE())
    `,
      [userId],
    );

    // 12. EDZÉS - Összes statisztika
    const [workoutTotalStats] = await db.execute(
      `
      SELECT 
        COUNT(*) as entries,
        COALESCE(SUM(duration_minutes), 0) as total_duration,
        COALESCE(SUM(calories_burned), 0) as total_calories,
        COALESCE(SUM(sets), 0) as total_sets
      FROM workout_entries 
      WHERE user_id = ?
    `,
      [userId],
    );

    // 13. EDZÉS - Legutóbbi 5 bejegyzés
    const [recentWorkoutEntries] = await db.execute(
      `
      SELECT 
        id,
        workout_type,
        exercise_name,
        duration_minutes,
        calories_burned,
        sets,
        reps,
        weight_kg,
        notes,
        date,
        created_at
      FROM workout_entries 
      WHERE user_id = ?
      ORDER BY date DESC, created_at DESC
      LIMIT 5
    `,
      [userId],
    );

    console.log("✅ Profil adatok összegyűjtve!");

    // 10. Válasz összeállítása
    res.json({
      success: true,
      profile: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          createdAt: user.created_at,
        },
        personal,
        // Alkohol statisztikák eltávolítva a profil válaszból
        food: {
          week: {
            entries: foodWeekStats[0].entries,
            totalCalories: foodWeekStats[0].total_calories,
            totalProtein: parseFloat(foodWeekStats[0].total_protein).toFixed(1),
            totalCarbs: parseFloat(foodWeekStats[0].total_carbs).toFixed(1),
          },
          month: {
            entries: foodMonthStats[0].entries,
            totalCalories: foodMonthStats[0].total_calories,
            totalProtein: parseFloat(foodMonthStats[0].total_protein).toFixed(
              1,
            ),
            totalCarbs: parseFloat(foodMonthStats[0].total_carbs).toFixed(1),
          },
          total: {
            entries: foodTotalStats[0].entries,
            totalCalories: foodTotalStats[0].total_calories,
            totalProtein: parseFloat(foodTotalStats[0].total_protein).toFixed(
              1,
            ),
            totalCarbs: parseFloat(foodTotalStats[0].total_carbs).toFixed(1),
          },
          recentEntries: recentFoodEntries.map((entry) => ({
            id: entry.id,
            foodName: entry.food_name,
            grams: entry.grams,
            calories: entry.calories,
            proteinG: parseFloat(entry.protein_g).toFixed(1),
            carbsG: parseFloat(entry.carbs_g).toFixed(1),
            date: entry.date,
            createdAt: entry.created_at,
          })),
        },
        workout: {
          week: {
            entries: workoutWeekStats[0].entries,
            totalDuration: workoutWeekStats[0].total_duration,
            totalCalories: workoutWeekStats[0].total_calories,
            totalSets: workoutWeekStats[0].total_sets,
          },
          month: {
            entries: workoutMonthStats[0].entries,
            totalDuration: workoutMonthStats[0].total_duration,
            totalCalories: workoutMonthStats[0].total_calories,
            totalSets: workoutMonthStats[0].total_sets,
          },
          total: {
            entries: workoutTotalStats[0].entries,
            totalDuration: workoutTotalStats[0].total_duration,
            totalCalories: workoutTotalStats[0].total_calories,
            totalSets: workoutTotalStats[0].total_sets,
          },
          recentEntries: recentWorkoutEntries.map((entry) => ({
            id: entry.id,
            workoutType: entry.workout_type,
            exerciseName: entry.exercise_name,
            durationMinutes: entry.duration_minutes,
            caloriesBurned: entry.calories_burned,
            sets: entry.sets,
            reps: entry.reps,
            weightKg: entry.weight_kg
              ? parseFloat(entry.weight_kg).toFixed(1)
              : null,
            notes: entry.notes,
            date: entry.date,
            createdAt: entry.created_at,
          })),
        },
      },
    });
  } catch (error) {
    console.error("❌ Profile error:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

// Személyes adatok mentése a felhasználó profiljához (életkor, súly, magasság stb.)
app.post("/api/profile/details", authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Adatbázis kapcsolat nincs!",
      });
    }

    const userId = req.user.userId;
    const { age, weight, height, gender, activity, goal, experience } =
      req.body;

    const ageInt =
      age !== undefined && age !== null && age !== ""
        ? parseInt(age, 10)
        : null;
    const weightKg =
      weight !== undefined && weight !== null && weight !== ""
        ? parseFloat(weight)
        : null;
    const heightCm =
      height !== undefined && height !== null && height !== ""
        ? parseInt(height, 10)
        : null;
    const activityMultiplier =
      activity !== undefined && activity !== null && activity !== ""
        ? parseFloat(activity)
        : null;

    await db.execute(
      `INSERT INTO user_profile (user_id, age, weight_kg, height_cm, gender, activity_multiplier, goal, experience)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         age = VALUES(age),
         weight_kg = VALUES(weight_kg),
         height_cm = VALUES(height_cm),
         gender = VALUES(gender),
         activity_multiplier = VALUES(activity_multiplier),
         goal = VALUES(goal),
         experience = VALUES(experience)`,
      [
        userId,
        ageInt,
        weightKg,
        heightCm,
        gender || null,
        activityMultiplier,
        goal || null,
        experience || null,
      ],
    );

    console.log("✅ Személyes adatok mentve a profilhoz:", userId);

    res.json({
      success: true,
      message: "Személyes adatok sikeresen mentve a profilhoz",
    });
  } catch (error) {
    console.error("❌ Személyes profil adatok mentési hiba:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

// DELETE /api/profile/details - Profil adatok törlése
app.delete("/api/profile/details", authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Adatbázis kapcsolat nincs!",
      });
    }

    const userId = req.user.userId;

    // Törlés az user_profile táblából
    await db.execute(`DELETE FROM user_profile WHERE user_id = ?`, [userId]);

    console.log("✅ Profil adatok törölve:", userId);

    res.json({
      success: true,
      message: "Profil adatok sikeresen törölve",
    });
  } catch (error) {
    console.error("❌ Profil adatok törlésének hiba:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

/* ====== ALCOHOL TRACKING ENDPOINTS ====== */

// Alkohol bejegyzés hozzáadása
app.post("/api/alcohol/add", authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Adatbázis kapcsolat nincs!",
      });
    }

    const { drinkType, amountMl, alcoholPercentage, calories, date } = req.body;
    const userId = req.user.userId;

    console.log("🍺 Alkohol hozzáadás:", { userId, drinkType, amountMl });

    if (
      !drinkType ||
      !amountMl ||
      alcoholPercentage === undefined ||
      !calories ||
      !date
    ) {
      return res.status(400).json({
        success: false,
        error: "Minden mező kitöltése kötelező",
      });
    }

    const [result] = await db.execute(
      "INSERT INTO alcohol_entries (user_id, drink_type, amount_ml, alcohol_percentage, calories, date) VALUES (?, ?, ?, ?, ?, ?)",
      [userId, drinkType, amountMl, alcoholPercentage, calories, date],
    );

    console.log("✅ Alkohol bejegyzés mentve! ID:", result.insertId);

    res.json({
      success: true,
      message: "Alkohol bejegyzés sikeresen hozzáadva",
      entryId: result.insertId,
    });
  } catch (error) {
    console.error("❌ Alcohol add error:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

// Alkohol bejegyzések lekérése (adott dátum vagy időszak)
app.get("/api/alcohol/entries", authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Adatbázis kapcsolat nincs!",
      });
    }

    const userId = req.user.userId;
    const { date, startDate, endDate } = req.query;

    let query = "SELECT * FROM alcohol_entries WHERE user_id = ?";
    let params = [userId];

    if (date) {
      query += " AND date = ?";
      params.push(date);
    } else if (startDate && endDate) {
      query += " AND date BETWEEN ? AND ?";
      params.push(startDate, endDate);
    }

    query += " ORDER BY date DESC, created_at DESC";

    const [entries] = await db.execute(query, params);

    res.json({
      success: true,
      entries,
    });
  } catch (error) {
    console.error("❌ Alcohol entries error:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

// Alkohol bejegyzés törlése
app.delete("/api/alcohol/:id", authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Adatbázis kapcsolat nincs!",
      });
    }

    const userId = req.user.userId;
    const entryId = req.params.id;

    // Először ellenőrizzük, hogy a bejegyzés a felhasználóé-e
    const [entries] = await db.execute(
      "SELECT id FROM alcohol_entries WHERE id = ? AND user_id = ?",
      [entryId, userId],
    );

    if (entries.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Bejegyzés nem található vagy nincs jogosultságod hozzá",
      });
    }

    await db.execute("DELETE FROM alcohol_entries WHERE id = ?", [entryId]);

    console.log("✅ Alkohol bejegyzés törölve! ID:", entryId);

    res.json({
      success: true,
      message: "Bejegyzés sikeresen törölve",
    });
  } catch (error) {
    console.error("❌ Alcohol delete error:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

// Alkohol statisztikák (összes kalória, ml stb. adott időszakra)
app.get("/api/alcohol/stats", authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Adatbázis kapcsolat nincs!",
      });
    }

    const userId = req.user.userId;
    const { startDate, endDate } = req.query;

    let query = `
      SELECT 
        COUNT(*) as total_entries,
        SUM(amount_ml) as total_ml,
        SUM(calories) as total_calories,
        AVG(alcohol_percentage) as avg_alcohol_percentage
      FROM alcohol_entries 
      WHERE user_id = ?
    `;
    let params = [userId];

    if (startDate && endDate) {
      query += " AND date BETWEEN ? AND ?";
      params.push(startDate, endDate);
    }

    const [stats] = await db.execute(query, params);

    res.json({
      success: true,
      stats: stats[0],
    });
  } catch (error) {
    console.error("❌ Alcohol stats error:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

/* ====== FOOD TRACKING ENDPOINTS ====== */

// Étel bejegyzés hozzáadása
app.post("/api/food/add", authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Adatbázis kapcsolat nincs!",
      });
    }

    const { foodName, grams, calories, proteinG, carbsG, date } = req.body;
    const userId = req.user.userId;

    console.log("🍎 Étel hozzáadás:", { userId, foodName, grams });

    if (
      !foodName ||
      !grams ||
      calories === undefined ||
      proteinG === undefined ||
      carbsG === undefined ||
      !date
    ) {
      return res.status(400).json({
        success: false,
        error: "Minden mező kitöltése kötelező",
      });
    }

    const [result] = await db.execute(
      "INSERT INTO food_entries (user_id, food_name, grams, calories, protein_g, carbs_g, date) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [userId, foodName, grams, calories, proteinG, carbsG, date],
    );

    console.log("✅ Étel bejegyzés mentve! ID:", result.insertId);

    res.json({
      success: true,
      message: "Étel bejegyzés sikeresen hozzáadva",
      entryId: result.insertId,
    });
  } catch (error) {
    console.error("❌ Food add error:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

/* ====== WORKOUT TRACKING ENDPOINTS ====== */

// POST /api/workout - Új edzés hozzáadása
app.post("/api/workout", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      workoutType,
      exerciseName,
      durationMinutes,
      caloriesBurned,
      sets,
      reps,
      weightKg,
      notes,
      date,
    } = req.body;

    console.log("🏋️ Edzés hozzáadása:", {
      userId,
      workoutType,
      exerciseName,
      durationMinutes,
      caloriesBurned,
      date,
    });

    // Input validáció
    if (
      !workoutType ||
      !exerciseName ||
      !durationMinutes ||
      !caloriesBurned ||
      !date
    ) {
      return res.status(400).json({
        success: false,
        error:
          "workoutType, exerciseName, durationMinutes, caloriesBurned és date megadása kötelező!",
      });
    }

    // Mentés az adatbázisba
    const [result] = await db.execute(
      "INSERT INTO workout_entries (user_id, workout_type, exercise_name, duration_minutes, calories_burned, sets, reps, weight_kg, notes, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        userId,
        workoutType,
        exerciseName,
        durationMinutes,
        caloriesBurned,
        sets || null,
        reps || null,
        weightKg || null,
        notes || null,
        date,
      ],
    );

    console.log("✅ Edzés bejegyzés mentve! ID:", result.insertId);

    res.json({
      success: true,
      message: "Edzés bejegyzés sikeresen hozzáadva",
      entryId: result.insertId,
    });
  } catch (error) {
    console.error("❌ Workout add error:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

// GET /api/workout - Edzés bejegyzések lekérése
app.get("/api/workout", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { startDate, endDate } = req.query;

    console.log("📊 Edzés bejegyzések lekérése:", {
      userId,
      startDate,
      endDate,
    });

    let query = "SELECT * FROM workout_entries WHERE user_id = ?";
    let params = [userId];

    if (startDate && endDate) {
      query += " AND date BETWEEN ? AND ?";
      params.push(startDate, endDate);
    }

    query += " ORDER BY date DESC, created_at DESC";

    const [entries] = await db.execute(query, params);

    console.log(`✅ ${entries.length} edzés bejegyzés lekérve`);

    res.json({
      success: true,
      entries: entries.map((entry) => ({
        id: entry.id,
        workoutType: entry.workout_type,
        exerciseName: entry.exercise_name,
        durationMinutes: entry.duration_minutes,
        caloriesBurned: entry.calories_burned,
        sets: entry.sets,
        reps: entry.reps,
        weightKg: entry.weight_kg
          ? parseFloat(entry.weight_kg).toFixed(1)
          : null,
        notes: entry.notes,
        date: entry.date,
        createdAt: entry.created_at,
      })),
    });
  } catch (error) {
    console.error("❌ Workout get error:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

// DELETE /api/workout - Összes edzés bejegyzés törlése (teszteléshez)
app.delete("/api/workout", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    console.log("🧹 Összes edzés bejegyzés törlése:", { userId });

    const [result] = await db.execute(
      "DELETE FROM workout_entries WHERE user_id = ?",
      [userId],
    );

    res.json({
      success: true,
      message: "Edzés bejegyzések sikeresen törölve",
      deletedCount: result.affectedRows || 0,
    });
  } catch (error) {
    console.error("❌ Workout bulk delete error:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

// DELETE /api/workout/:id - Edzés bejegyzés törlése
app.delete("/api/workout/:id", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const entryId = req.params.id;

    console.log("🗑️ Edzés bejegyzés törlése:", { userId, entryId });

    // Ellenőrizzük, hogy a bejegyzés létezik és a felhasználóhoz tartozik
    const [entries] = await db.execute(
      "SELECT id FROM workout_entries WHERE id = ? AND user_id = ?",
      [entryId, userId],
    );

    if (entries.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Edzés bejegyzés nem található vagy nem a te bejegyzésed",
      });
    }

    await db.execute("DELETE FROM workout_entries WHERE id = ?", [entryId]);

    console.log("✅ Edzés bejegyzés törölve!");

    res.json({
      success: true,
      message: "Edzés bejegyzés sikeresen törölve",
    });
  } catch (error) {
    console.error("❌ Workout delete error:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

// Étel bejegyzések lekérése (adott dátum vagy időszak)
app.get("/api/food/entries", authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Adatbázis kapcsolat nincs!",
      });
    }

    const userId = req.user.userId;
    const { date, startDate, endDate } = req.query;

    let query = "SELECT * FROM food_entries WHERE user_id = ?";
    let params = [userId];

    if (date) {
      query += " AND date = ?";
      params.push(date);
    } else if (startDate && endDate) {
      query += " AND date BETWEEN ? AND ?";
      params.push(startDate, endDate);
    }

    query += " ORDER BY date DESC, created_at DESC";

    const [entries] = await db.execute(query, params);

    res.json({
      success: true,
      entries,
    });
  } catch (error) {
    console.error("❌ Food entries error:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

// Étel bejegyzés törlése
app.delete("/api/food/:id", authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Adatbázis kapcsolat nincs!",
      });
    }

    const userId = req.user.userId;
    const entryId = req.params.id;

    const [entries] = await db.execute(
      "SELECT id FROM food_entries WHERE id = ? AND user_id = ?",
      [entryId, userId],
    );

    if (entries.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Bejegyzés nem található vagy nincs jogosultságod hozzá",
      });
    }

    await db.execute("DELETE FROM food_entries WHERE id = ?", [entryId]);

    console.log("✅ Étel bejegyzés törölve! ID:", entryId);

    res.json({
      success: true,
      message: "Bejegyzés sikeresen törölve",
    });
  } catch (error) {
    console.error("❌ Food delete error:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

/* ====== SKIN ROUTINE ENDPOINTS ====== */

// Rutin mentése
app.post("/api/skin/save-routine", authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Adatbázis kapcsolat nincs!",
      });
    }

    const { answers, routine } = req.body;
    const userId = req.user.userId;

    console.log("💾 Rutin mentése kérés:", { userId, answers, routine });

    const normalizeArray = (value) => (Array.isArray(value) ? value : []);
    const normalizeJsonString = (value) => {
      try {
        return JSON.stringify(JSON.parse(value || "[]"));
      } catch {
        return JSON.stringify([]);
      }
    };

    const payload = {
      skin_type: answers?.skin_type || routine?.skin_type || "normal",
      age_group: answers?.age || routine?.age_group || "25_35",
      concerns: JSON.stringify(
        normalizeArray(answers?.concerns || routine?.concerns),
      ),
      goals: JSON.stringify(normalizeArray(answers?.goals || routine?.goals)),
      morning_routine: JSON.stringify(normalizeArray(routine?.morning_routine)),
      evening_routine: JSON.stringify(normalizeArray(routine?.evening_routine)),
      weekly_treatments: JSON.stringify(
        normalizeArray(routine?.weekly_treatments),
      ),
      product_recommendations: JSON.stringify(
        normalizeArray(routine?.product_recommendations),
      ),
      tips: JSON.stringify(normalizeArray(routine?.tips)),
    };

    const [existingRows] = await db.execute(
      `
      SELECT *
      FROM skin_routines
      WHERE user_id = ? AND is_active = TRUE
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
      `,
      [userId],
    );

    if (existingRows.length > 0) {
      const existing = existingRows[0];

      const hasNoChanges =
        String(existing.skin_type || "") === String(payload.skin_type) &&
        String(existing.age_group || "") === String(payload.age_group) &&
        normalizeJsonString(existing.concerns) === payload.concerns &&
        normalizeJsonString(existing.goals) === payload.goals &&
        normalizeJsonString(existing.morning_routine) ===
          payload.morning_routine &&
        normalizeJsonString(existing.evening_routine) ===
          payload.evening_routine &&
        normalizeJsonString(existing.weekly_treatments) ===
          payload.weekly_treatments &&
        normalizeJsonString(existing.product_recommendations) ===
          payload.product_recommendations &&
        normalizeJsonString(existing.tips) === payload.tips;

      if (hasNoChanges) {
        return res.json({
          success: true,
          unchanged: true,
          message: "Nincs változás a rutinban.",
          routine_id: existing.id,
        });
      }

      await db.execute(
        `
        UPDATE skin_routines
        SET skin_type = ?,
            age_group = ?,
            concerns = ?,
            goals = ?,
            morning_routine = ?,
            evening_routine = ?,
            weekly_treatments = ?,
            product_recommendations = ?,
            tips = ?,
            is_active = TRUE
        WHERE id = ? AND user_id = ?
        `,
        [
          payload.skin_type,
          payload.age_group,
          payload.concerns,
          payload.goals,
          payload.morning_routine,
          payload.evening_routine,
          payload.weekly_treatments,
          payload.product_recommendations,
          payload.tips,
          existing.id,
          userId,
        ],
      );

      await db.execute(
        "UPDATE skin_routines SET is_active = FALSE WHERE user_id = ? AND id <> ?",
        [userId, existing.id],
      );

      console.log("✅ Rutin frissítve! ID:", existing.id);

      return res.json({
        success: true,
        updated: true,
        message: "Rutin frissítve.",
        routine_id: existing.id,
      });
    }

    const [result] = await db.execute(
      `
      INSERT INTO skin_routines (
        user_id, skin_type, age_group, concerns, goals,
        morning_routine, evening_routine, weekly_treatments,
        product_recommendations, tips
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        userId,
        payload.skin_type,
        payload.age_group,
        payload.concerns,
        payload.goals,
        payload.morning_routine,
        payload.evening_routine,
        payload.weekly_treatments,
        payload.product_recommendations,
        payload.tips,
      ],
    );

    console.log("✅ Új rutin mentve! ID:", result.insertId);

    res.json({
      success: true,
      inserted: true,
      message: "Rutin sikeresen elmentve!",
      routine_id: result.insertId,
    });
  } catch (error) {
    console.error("❌ Rutin mentési hiba:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

// Rutin lekérése
app.get("/api/skin/routine", authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Adatbázis kapcsolat nincs!",
      });
    }

    const userId = req.user.userId;

    const [routines] = await db.execute(
      `
      SELECT * FROM skin_routines 
      WHERE user_id = ? AND is_active = TRUE 
      ORDER BY created_at DESC 
      LIMIT 1
    `,
      [userId],
    );

    if (routines.length === 0) {
      return res.json({
        success: true,
        routine: null,
        message: "Nincs még mentett rutina",
      });
    }

    const routine = routines[0];

    // JSON mezők parse-olása
    routine.concerns = JSON.parse(routine.concerns || "[]");
    routine.goals = JSON.parse(routine.goals || "[]");
    routine.morning_routine = JSON.parse(routine.morning_routine || "[]");
    routine.evening_routine = JSON.parse(routine.evening_routine || "[]");
    routine.weekly_treatments = JSON.parse(routine.weekly_treatments || "[]");
    routine.product_recommendations = JSON.parse(
      routine.product_recommendations || "[]",
    );
    routine.tips = JSON.parse(routine.tips || "[]");

    console.log("✅ Rutin lekérve:", routine.id);

    res.json({
      success: true,
      routine: routine,
    });
  } catch (error) {
    console.error("❌ Rutin lekérési hiba:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

// Rutin követés (napi checkboxok)
app.post("/api/skin/tracking", authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Adatbázis kapcsolat nincs!",
      });
    }

    const {
      routine_id,
      date,
      morning_completed,
      evening_completed,
      morning_steps,
      evening_steps,
      notes,
    } = req.body;
    const userId = req.user.userId;

    console.log("📊 Rutin követés mentése:", {
      userId,
      routine_id,
      date,
      morning_completed,
      evening_completed,
    });

    // Ellenőrizzük, hogy létezik-e már mai bejegyzés
    const [existing] = await db.execute(
      "SELECT id FROM skin_routine_tracking WHERE user_id = ? AND routine_id = ? AND date = ?",
      [userId, routine_id, date],
    );

    if (existing.length > 0) {
      // Frissítés
      await db.execute(
        `
        UPDATE skin_routine_tracking 
        SET morning_completed = ?, evening_completed = ?, morning_steps = ?, evening_steps = ?, notes = ?
        WHERE id = ?
      `,
        [
          morning_completed,
          evening_completed,
          JSON.stringify(morning_steps || []),
          JSON.stringify(evening_steps || []),
          notes,
          existing[0].id,
        ],
      );
    } else {
      // Új bejegyzés
      await db.execute(
        `
        INSERT INTO skin_routine_tracking 
        (user_id, routine_id, date, morning_completed, evening_completed, morning_steps, evening_steps, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          userId,
          routine_id,
          date,
          morning_completed,
          evening_completed,
          JSON.stringify(morning_steps || []),
          JSON.stringify(evening_steps || []),
          notes,
        ],
      );
    }

    console.log("✅ Rutin követés elmentve!");

    res.json({
      success: true,
      message: "Követés sikeresen elmentve!",
    });
  } catch (error) {
    console.error("❌ Rutin követési hiba:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

// Napi rutin követés lekérése
app.get("/api/skin/tracking", authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Adatbázis kapcsolat nincs!",
      });
    }

    const userId = req.user.userId;
    const { routine_id, date } = req.query;

    if (!routine_id) {
      return res.status(400).json({
        success: false,
        error: "A routine_id kötelező",
      });
    }

    let query = `
      SELECT *
      FROM skin_routine_tracking
      WHERE user_id = ? AND routine_id = ?
    `;
    const params = [userId, Number(routine_id)];

    if (date) {
      query += " AND date = ?";
      params.push(date);
    }

    query += " ORDER BY date DESC, created_at DESC LIMIT 1";

    const [rows] = await db.execute(query, params);

    if (rows.length === 0) {
      return res.json({
        success: true,
        tracking: null,
      });
    }

    const tracking = rows[0];
    tracking.morning_steps = JSON.parse(tracking.morning_steps || "[]");
    tracking.evening_steps = JSON.parse(tracking.evening_steps || "[]");

    res.json({
      success: true,
      tracking,
    });
  } catch (error) {
    console.error("❌ Rutin követés lekérési hiba:", error);
    res
      .status(500)
      .json({ success: false, error: "Szerver hiba: " + error.message });
  }
});

/* ====== START ====== */
app.listen(3000, () => {
  console.log("Backend fut: http://localhost:3000");
});
