# Vercel Email Setup Guide

## ✅ What Was Changed

Your announcement system now sends emails directly from your SMTP server using Vercel serverless functions instead of Supabase Edge Functions.

### Files Created:
1. `package.json` - Node.js dependencies (nodemailer)
2. `api/send-announcement.js` - Vercel serverless function for sending emails
3. `vercel.json` - Vercel configuration (60-second timeout for email sending)

### Files Modified:
1. `js/clients.js` - Updated to call Vercel API instead of Supabase Edge Function

---

## 🚀 Deployment Steps (FOLLOW THESE)

### **STEP 1: Install Dependencies Locally (Optional - For Testing)**

Open Command Prompt/Terminal in your project folder and run:

```bash
cd "C:\Users\ali.elzein\Desktop\Ticketing Git Version\ticket-tracker-app"
npm install
```

This installs `nodemailer` locally. **You can skip this if you just want to deploy to Vercel directly.**

---

### **STEP 2: Push Changes to GitHub**

```bash
git add .
git commit -m "Add Vercel serverless email function with SMTP"
git push origin main
```

---

### **STEP 3: Deploy to Vercel**

If your project is already connected to Vercel, it will auto-deploy when you push to GitHub.

**If not connected yet:**

1. Go to https://vercel.com/dashboard
2. Click "Add New" → "Project"
3. Import your GitHub repository
4. Click "Deploy"

Vercel will automatically:
- Install `nodemailer` from `package.json`
- Create the serverless function at `/api/send-announcement`
- Deploy your site

---

### **STEP 4: Verify Deployment**

After deployment, Vercel will give you a URL like:
```
https://your-project-name.vercel.app
```

**Test the API endpoint:**

Open browser console on your site and run:
```javascript
fetch('https://your-project-name.vercel.app/api/send-announcement', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    subject: 'Test',
    body: '<p>Test email</p>',
    to: ['test@example.com'],
    smtp: {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      smtp_user: 'your-email@gmail.com',
      smtp_password: 'your-app-password',
      from_email: 'your-email@gmail.com',
      from_name: 'Test'
    }
  })
})
.then(r => r.json())
.then(console.log)
.catch(console.error);
```

You should see a success response with `messageId`.

---

## 📧 How It Works Now

### **Before (Supabase Edge Function):**
```
Frontend → Supabase Edge Function → ❌ SMTP not supported
```

### **After (Vercel Serverless Function):**
```
Frontend → Vercel API (/api/send-announcement) → Your SMTP Server → Recipients
```

---

## 🔧 Features Included

### ✅ **Automatic BCC Batching**
- If you have 500+ BCC recipients, emails are sent in batches of 50
- Prevents timeout on large mailing lists

### ✅ **Error Handling**
- SMTP connection verification before sending
- Detailed error messages
- Batch-level success/failure tracking

### ✅ **Works with Any SMTP**
- Gmail (use App Password, not regular password)
- Outlook/Office 365
- Your custom SMTP server
- Any SMTP provider

### ✅ **Supports TO, CC, BCC**
- Properly handles all recipient types
- First batch gets TO/CC, subsequent batches get BCC only

---

## ⚙️ SMTP Configuration

Your SMTP config is stored in Supabase `smtp_config` table:

| Field | Example | Notes |
|-------|---------|-------|
| `host` | `smtp.gmail.com` | Your SMTP server |
| `port` | `587` | 587 for TLS, 465 for SSL |
| `secure` | `false` | `true` for port 465, `false` for 587 |
| `smtp_user` | `your-email@gmail.com` | SMTP username |
| `smtp_password` | `app-password` | App password (not regular password!) |
| `from_email` | `support@b-pal.net` | Sender email |
| `from_name` | `B-Pal Support Team` | Sender name |

### **Gmail Setup:**
1. Enable 2-Factor Authentication: https://myaccount.google.com/security
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Use the 16-character app password (not your regular password)

---

## 🐛 Troubleshooting

### **Error: "SMTP connection failed"**
- Check your SMTP host, port, username, and password
- For Gmail: Use App Password, not regular password
- For Office 365: Enable SMTP AUTH in admin settings

### **Error: "Timeout" or "Function exceeded max duration"**
- Reduce BCC batch size (change `BCC_BATCH_SIZE` in `api/send-announcement.js`)
- Upgrade to Vercel Pro for 60-second timeout (Hobby has 10s)

### **Error: "CORS"**
- Make sure you're calling from the same domain (your Vercel site)
- CORS is already configured in the API route

### **Emails not arriving**
- Check spam folder
- Verify SMTP credentials
- Check Vercel function logs: https://vercel.com/dashboard → Project → Functions

---

## 📊 Vercel Function Logs

To see email sending logs:

1. Go to https://vercel.com/dashboard
2. Click your project
3. Go to "Functions" tab
4. Click `send-announcement`
5. View real-time logs

You'll see:
- SMTP connection status
- Batch sending progress
- Error details (if any)

---

## 🔒 Security Notes

- SMTP credentials are stored in Supabase database (encrypted at rest)
- Credentials are sent from frontend to Vercel API (use HTTPS only!)
- Vercel API runs server-side, so credentials are not exposed to users
- Consider storing SMTP credentials in Vercel Environment Variables for extra security (optional)

### **Optional: Use Vercel Environment Variables**

1. Go to Vercel Dashboard → Project → Settings → Environment Variables
2. Add:
   - `SMTP_HOST` = `smtp.gmail.com`
   - `SMTP_PORT` = `587`
   - `SMTP_USER` = `your-email@gmail.com`
   - `SMTP_PASSWORD` = `app-password`
3. Modify `api/send-announcement.js` to use `process.env.SMTP_HOST` instead of `smtp.host`

---

## ✅ Testing Checklist

- [ ] Deploy to Vercel successfully
- [ ] Configure SMTP settings in app
- [ ] Send test email (internal template with TO/CC)
- [ ] Send test email (external template with BCC)
- [ ] Check recipient inboxes (TO, CC, BCC)
- [ ] Check Vercel function logs for errors

---

## 📞 Support

If you encounter issues:
1. Check Vercel function logs
2. Test SMTP credentials with a desktop email client (Outlook, Thunderbird)
3. Review error messages in browser console

---

## 🎉 You're Done!

Once deployed, your announcement system will send emails directly from your SMTP server with full control and no third-party email services!
