# Template Migration Script

## Instructions:

1. Open your **Clients page** in your browser (https://b-pal-tickets.vercel.app/clients.html)
2. Open the browser console (F12 or Right-click → Inspect → Console tab)
3. Copy and paste the entire script below into the console
4. Press Enter to run it
5. You'll see success messages for each template created

---

## Migration Script:

```javascript
// Copy everything from here to the end and paste into console

(async function migrateTemplates() {
    console.log('Starting template migration...');

    const templates = [
        {
            name: 'Urgent Maintenance',
            subject: 'Urgent Maintenance Notification',
            body: `<p>Hello Team,</p>
<p>Kindly note that we have an urgent maintenance next Tuesday 21/10/2025 at 6 AM GMT time, which will require a restart of the B-Pal Web service.</p>
<p>The downtime will be 5-10 minutes; please don't make any updates on B-Pal during the activity.</p>
<p>Traffic will not be affected by this maintenance.</p>
<p>Regards,<br>B-Pal Support Team</p>`,
            template_type: 'external',
            to_recipients: '',
            cc: '"Ali Sabbagh" <ali.sabbagh@montymobile.com>, "B-Pal Support" <support@b-pal.net>, "Mohammad Aboud" <mohammad.aboud@montymobile.com>',
            bcc: ''
        },
        {
            name: 'Scheduled Maintenance',
            subject: 'Scheduled Maintenance Notification',
            body: `<p>Hello Team,</p>
<p>We would like to inform you that on Sep 16, 2025, a maintenance will take place Tuesday September 16th as per the below.<br>
You might face service interruptions at the web level between 5:45 am and 6:15 am GMT time.<br>
Traffic will not be affected.</p>
<p><strong>BPAL Maintenance</strong></p>
<table style="border-collapse: collapse; width: 100%; border: 1px solid #ddd;">
<tbody>
<tr>
<td style="border: 1px solid #ddd; padding: 8px;"><strong>Date</strong></td>
<td style="border: 1px solid #ddd; padding: 8px;">Date/Time (GMT Time):<br>Tuesday Sep 16th, 2025, between 5:45 and 6:15 am</td>
</tr>
<tr>
<td style="border: 1px solid #ddd; padding: 8px;"><strong>IMPACT</strong></td>
<td style="border: 1px solid #ddd; padding: 8px;">User may face interruption at the level of BPAL web</td>
</tr>
</tbody>
</table>
<p>Regards,<br>B-Pal Support Team</p>`,
            template_type: 'external',
            to_recipients: '',
            cc: '"Ali Sabbagh" <ali.sabbagh@montymobile.com>, "B-Pal Support" <support@b-pal.net>, "Mohammad Aboud" <mohammad.aboud@montymobile.com>',
            bcc: ''
        }
    ];

    let created = 0;
    let skipped = 0;

    try {
        for (const template of templates) {
            // Check if template already exists
            const { data: existing } = await supabase
                .from('email_templates')
                .select('id')
                .eq('name', template.name)
                .single();

            if (existing) {
                console.log(`✓ Template "${template.name}" already exists, skipping...`);
                skipped++;
                continue;
            }

            // Insert template
            const { error } = await supabase
                .from('email_templates')
                .insert(template);

            if (error) throw error;

            console.log(`✅ Created template: "${template.name}"`);
            created++;
        }

        console.log('\n========================================');
        console.log('✅ MIGRATION COMPLETE!');
        console.log(`   Created: ${created} template(s)`);
        console.log(`   Skipped: ${skipped} template(s)`);
        console.log('========================================');
        console.log('\nYou can now:');
        console.log('1. Refresh the page');
        console.log('2. Click "Send Announcement"');
        console.log('3. Your templates will appear in the dropdown');

    } catch (error) {
        console.error('❌ Migration failed:', error);
        console.error('Error details:', error.message);
    }
})();
```

---

## Expected Output:

```
Starting template migration...
✅ Created template: "Urgent Maintenance"
✅ Created template: "Scheduled Maintenance"

========================================
✅ MIGRATION COMPLETE!
   Created: 2 template(s)
   Skipped: 0 template(s)
========================================

You can now:
1. Refresh the page
2. Click "Send Announcement"
3. Your templates will appear in the dropdown
```

---

## Verification:

After running the script:
1. Click "Manage Templates" button
2. You should see both templates listed
3. Click "Send Announcement" and check the template dropdown

---

## Troubleshooting:

**If you get an error:**
- Make sure you're logged into the app (not on the login page)
- Make sure you're on the Clients page specifically
- Check that `supabase` is defined by typing `supabase` in console

**If templates already exist:**
- The script will skip them automatically
- You can delete them from "Manage Templates" and run again if needed
