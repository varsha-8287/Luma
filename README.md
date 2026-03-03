# 🚀 Luma — Light your Day

Full-stack backend for the QuestFlow gamified productivity app.
Built with **Python + Flask**, **MongoDB Atlas**, and a complete AI-powered services layer.

---

## 📁 Backend Structure

```
backend/
├── app.py                          # Flask app factory + APScheduler midnight cron
├── config.py                       # All env-based config constants
├── requirements.txt                # Python dependencies
├── .env.example                    # Copy to .env and fill in
│
├── models/
│   ├── user_model.py               # User CRUD + XP + streak
│   ├── task_model.py               # Task CRUD + overdue detection
│   ├── mood_model.py               # Mood logging + daily summaries
│   └── journal_model.py            # Journal entries
│
├── routes/
│   ├── auth_routes.py              # POST /register  POST /login
│   ├── task_routes.py              # CRUD + smart-ranked
│   ├── mood_routes.py              # Log mood + daily summary
│   ├── analytics_routes.py         # Score, patterns, prediction, wrapped
│   ├── reminder_routes.py          # In-app + Twilio voice call
│   └── journal_routes.py           # Journal CRUD + gamification endpoints
│
├── services/
│   ├── scheduling_algorithm.py     # Smart rank: priority × deadline × behavior
│   ├── productivity_score.py       # Multi-factor discipline score (0–100)
│   ├── behavioral_analysis.py      # Burnout + procrastination detection
│   ├── predictive_model.py         # Rule-based completion probability
│   ├── reminder_engine.py          # Adaptive reminders + Twilio TwiML
│   └── gamification_engine.py      # XP multipliers, badges, streak, Wrapped
│
└── utils/
    ├── db.py                       # MongoDB singleton + index creation
    └── helpers.py                  # Serialization, date helpers, response builders
```

---

## ⚡ Quick Start

### 1. Prerequisites
- Python 3.10+ installed
- MongoDB Atlas account (free M0 cluster works)

### 2. Clone & Install

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate

# Mac/Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
MONGO_URI=mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/gamified_app?retryWrites=true&w=majority
JWT_SECRET_KEY=your-super-secret-key-here
PORT=5000
```

### 4. MongoDB Atlas Setup

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com)
2. Create a **free M0 cluster**
3. Create a database user (Settings → Database Access)
4. Whitelist all IPs: `0.0.0.0/0` (Network Access)
5. Click **Connect → Drivers → Python** and copy the URI
6. Paste URI into `.env` as `MONGO_URI` (replace `<password>`)

### 5. Run the Server

```bash
python app.py
```

Server starts at `http://localhost:5000`

---

## 📡 API Reference

### Authentication
| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | `{name, email, password}` | Create account |
| POST | `/api/auth/login` | `{email, password}` | Get JWT token |

All other endpoints require: `Authorization: Bearer <token>`

### Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/tasks` | Create task `{name, description, deadline, priority, category}` |
| GET | `/api/tasks` | Get all tasks (auto-marks overdue as Missed) |
| GET | `/api/tasks/smart-ranked` | Pending tasks sorted by AI rank |
| PUT | `/api/tasks/:id/complete` | Complete task → awards XP with multiplier |
| DELETE | `/api/tasks/:id` | Delete task |

### Mood
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/mood` | Log mood `{moodType: "Happy|Neutral|Sad|Angry|Tired"}` |
| GET | `/api/mood` | Get mood history |
| GET | `/api/mood/daily-summary` | Today's average mood |

### Analytics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/analytics/productivity-score` | Multi-factor discipline score 0–100 |
| GET | `/api/analytics/weekly-stats` | Day-by-day XP, mood, completion charts |
| GET | `/api/analytics/patterns` | Burnout/procrastination/peak-hour detection |
| GET | `/api/analytics/prediction` | Completion probability for today |
| GET | `/api/analytics/wrapped` | Spotify-style weekly recap |

### Journal
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/journal` | Create entry `{title, content}` |
| GET | `/api/journal` | Get all entries |
| DELETE | `/api/journal/:id` | Delete entry |

### Gamification
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/gamification/badges` | All earned badges |
| GET | `/api/gamification/xp-history` | XP event log |

### Reminders
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reminders` | Tasks due within 24h with adaptive tone |
| PUT | `/api/reminders/:id/ack` | Acknowledge reminder |
| POST | `/api/reminders/call` | Trigger Twilio voice call `{phone}` |

---

## 🎮 Gamification System

### XP Rules
| Event | Base XP | With Multiplier |
|-------|---------|-----------------|
| Complete early | +20 | up to +36 |
| Complete on time | +10 | up to +18 |
| Task missed | -10 | always -10 |
| 3-day streak | +15 bonus | — |
| 7-day streak | +50 bonus | — |
| Positive mood day | +5 | — |

### XP Multiplier Formula
```
multiplier = 1.0 + streak_bonus + mood_bonus
streak_bonus = min(0.5,  streak × 0.05)   # max +50%
mood_bonus   = min(0.25, mood_streak × 0.05)  # max +25%
```

### Level Formula
```
level = floor(totalXP / 100)
```

### Productivity Score (0–100)
```
score = 35% × completion_rate
      + 25% × streak_score
      + 20% × task_difficulty
      + 20% × mood_stability
```

### Badges (18 total)
⚔️ First Blood · 📋 Quest Adept · 🗡️ Quest Master · 👑 Quest Champion
🔥 On Fire (3d) · 🌊 Unstoppable (7d) · 🌟 Legendary Streak (30d)
💫 XP Hunter (100) · ⭐ XP Warrior (500) · 🏆 XP Legend (1000)
🎯 Apprentice Hero (Lv5) · 🦸 True Hero (Lv10) · 🧙 Productivity Sage (Lv25)
🐦 Early Bird · 😊 Mood Warrior · 💎 Perfect Day · 📖 Chronicler · 🦉 Night Owl

---

## ⏰ Midnight Cron Job (APScheduler)

Runs at **00:00 UTC daily**:
1. Marks all overdue Pending tasks as **Missed** → deducts XP
2. Calculates daily **mood summary** per user
3. Awards **mood bonus XP** for positive days
4. Updates **streak** (increment or reset to 0)
5. Recomputes **productivity score** for all users
6. Re-runs **smart ranking** on all pending tasks

---

## 📞 Twilio Voice Calls (Optional)

Add to `.env`:
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX
```

Tone adapts based on productivity score:
- Score ≥ 70 → **Motivational** ("You're crushing it!")
- Score 40–69 → **Balanced** ("Stay focused!")
- Score < 40 → **Strict** ("URGENT: Act NOW!")

---

## 🔧 Development Tips

```bash
# Test the API with curl
curl http://localhost:5000/

# Register a user
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Hero","email":"hero@test.com","password":"test123"}'

# Login and get token
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"hero@test.com","password":"test123"}'
```