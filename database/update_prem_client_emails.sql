-- Update emails for existing PREM clients
UPDATE clients SET emails = ARRAY['sms.support@falconinfosystems.com','reddy@falconinfosystems.com']
WHERE name = 'Falcon 1'  AND client_type = 'prem';

UPDATE clients SET emails = ARRAY['sms.support@falconinfosystems.com','reddy@falconinfosystems.com']
WHERE name = 'Falcon 2'  AND client_type = 'prem';

UPDATE clients SET emails = ARRAY['support@fusionbd.net','rony@fusionbd.net']
WHERE name = 'Fusion'    AND client_type = 'prem';

UPDATE clients SET emails = ARRAY['pallavi@iconglobal.co.uk','jaspreet@iconglobal.co.uk','bobby@iconglobal.co.uk']
WHERE name = 'Icon Global' AND client_type = 'prem';

UPDATE clients SET emails = ARRAY['sms.noc@inetglobalservices.com','renu@inetglobalservices.com','nidhi@inetglobalservices.com','naveen@inetglobalservices.com']
WHERE name = 'Inet'      AND client_type = 'prem';

UPDATE clients SET emails = ARRAY['serxhio.xhaferaj@infotelecom-ics.com','rafael.selamaj@infotelecom-ics.com']
WHERE name = 'InfoTelecom' AND client_type = 'prem';

UPDATE clients SET emails = ARRAY['rakesh@1worldtec.com','billing@1worldtec.com','kamal@1worldtec.com','noc@1worldtec.com']
WHERE name = 'OneWorld'  AND client_type = 'prem';

UPDATE clients SET emails = ARRAY['ramsey.ezz@teways.com','support@teways.com']
WHERE name = 'Teways'    AND client_type = 'prem';

UPDATE clients SET emails = ARRAY['mukesh.k@vfirst.com','Simanta.anjan@vfirst.com','rajesh.bahl@vfirst.com','Jatin.Sehgal@vfirst.com','Ashu.Agarwal@vfirst.com','Debmalya.De@vfirst.com']
WHERE name = 'Value First-Win' AND client_type = 'prem';

UPDATE clients SET emails = ARRAY['sms.noc@vespertelecom.com','ajay@vespertelecom.com','sahil@vespertelecom.com','prasad@vespertelecom.com']
WHERE name = 'Vesper'    AND client_type = 'prem';

UPDATE clients SET emails = ARRAY['rahul.chonsaliya@zen.ae','anand.jadhav@a2pmobility.com','smruti.chavan@a2pmobility.com','kavita.kadam@zen.ae']
WHERE name = 'Zentech'   AND client_type = 'prem';

-- Verify
SELECT name, emails FROM clients WHERE client_type = 'prem' ORDER BY name;
