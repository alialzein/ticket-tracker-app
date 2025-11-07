// Vercel Serverless Function to Send Emails via SMTP
// Path: /api/send-announcement

import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  // Enable CORS for your frontend
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const { subject, body, to, cc, bcc, smtp } = req.body;

    // Validate required fields
    if (!subject || !body) {
      return res.status(400).json({ error: 'Subject and body are required' });
    }

    if (!smtp || !smtp.host || !smtp.smtp_user || !smtp.smtp_password) {
      return res.status(400).json({ error: 'SMTP configuration is incomplete' });
    }

    // Check if there are any recipients
    const hasRecipients = (to && to.length > 0) || (cc && cc.length > 0) || (bcc && bcc.length > 0);
    if (!hasRecipients) {
      return res.status(400).json({ error: 'At least one recipient (TO, CC, or BCC) is required' });
    }

    console.log('Creating SMTP transporter...');

    // Create SMTP transporter
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: parseInt(smtp.port) || 587,
      secure: smtp.secure === true || smtp.secure === 'true', // true for 465, false for 587
      auth: {
        user: smtp.smtp_user,
        pass: smtp.smtp_password
      },
      tls: {
        rejectUnauthorized: false // Allow self-signed certificates (adjust based on your needs)
      }
    });

    console.log('Verifying SMTP connection...');

    // Verify SMTP connection before sending
    try {
      await transporter.verify();
      console.log('SMTP connection verified successfully');
    } catch (verifyError) {
      console.error('SMTP verification failed:', verifyError);
      return res.status(500).json({
        error: 'SMTP connection failed',
        details: verifyError.message
      });
    }

    // Handle large BCC lists by batching (Vercel has 10s timeout on Hobby plan)
    const BCC_BATCH_SIZE = 50;
    const totalBcc = bcc ? bcc.length : 0;
    const batches = [];

    if (totalBcc > BCC_BATCH_SIZE) {
      // Split BCC into batches
      for (let i = 0; i < totalBcc; i += BCC_BATCH_SIZE) {
        batches.push(bcc.slice(i, i + BCC_BATCH_SIZE));
      }
      console.log(`Splitting ${totalBcc} BCC recipients into ${batches.length} batches`);
    } else {
      // Single batch
      batches.push(bcc || []);
    }

    const results = [];
    let successCount = 0;
    let failCount = 0;

    // Send email for each batch
    for (let i = 0; i < batches.length; i++) {
      const currentBatch = batches[i];

      try {
        console.log(`Sending batch ${i + 1}/${batches.length} (${currentBatch.length} BCC recipients)...`);

        const mailOptions = {
          from: `"${smtp.from_name || 'B-Pal Support Team'}" <${smtp.from_email}>`,
          subject: subject,
          html: body
        };

        // First batch gets TO and CC, subsequent batches only get BCC
        if (i === 0) {
          if (to && to.length > 0) mailOptions.to = to.join(', ');
          if (cc && cc.length > 0) mailOptions.cc = cc.join(', ');
        }

        // Add BCC for this batch
        if (currentBatch.length > 0) {
          mailOptions.bcc = currentBatch.join(', ');
        }

        const info = await transporter.sendMail(mailOptions);

        console.log(`Batch ${i + 1} sent successfully. Message ID: ${info.messageId}`);

        results.push({
          batch: i + 1,
          success: true,
          messageId: info.messageId,
          recipients: currentBatch.length
        });

        successCount += currentBatch.length;

      } catch (sendError) {
        console.error(`Batch ${i + 1} failed:`, sendError);

        results.push({
          batch: i + 1,
          success: false,
          error: sendError.message,
          recipients: currentBatch.length
        });

        failCount += currentBatch.length;
      }
    }

    // Return success response
    return res.status(200).json({
      success: true,
      message: 'Email sent successfully',
      totalRecipients: {
        to: to ? to.length : 0,
        cc: cc ? cc.length : 0,
        bcc: totalBcc,
        total: (to ? to.length : 0) + (cc ? cc.length : 0) + totalBcc
      },
      batches: batches.length,
      results: results,
      summary: {
        sent: successCount,
        failed: failCount
      }
    });

  } catch (error) {
    console.error('Unexpected error in send-announcement:', error);

    return res.status(500).json({
      error: 'Failed to send email',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
