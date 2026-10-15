# Finish the domain transfers

1. Open [Squarespace Domains](https://account.squarespace.com/domains).

2. Open [Cloudflare](https://dash.cloudflare.com/) in another tab.
   All 14 zones already exist. Use those zones; don't create new ones.

3. Keep the migration executor stopped while working manually.
   No registrar transfers had been submitted at the last check.

4. Wait until **October 16, 2026, at 4 p.m. Arizona time** for the existing cache waits.
   `emulates.dev` needs the additional wait below.

5. Open [emulates.dev DNSSEC](https://account.squarespace.com/domains/managed/emulates.dev/dns/dnssec).
   Confirm DNSSEC is **Off**. It was already switched off successfully.

6. Open [emulates.dev's public DS lookup](https://dns.google/query?name=emulates.dev&type=DS).
   Wait until it shows `Status: 0` with no DS answer.

7. Wait **48 hours after that DS answer disappears** before changing its nameservers.
   Keep DNSSEC off throughout migration.

8. For each of the next ten links, click **Use custom nameservers**.
   Replace the old nameservers with exactly these two, then click **Save**:

   ```text
   carioca.ns.cloudflare.com
   dan.ns.cloudflare.com
   ```

9. Update [colddrive.app nameservers](https://account.squarespace.com/domains/managed/colddrive.app/dns/domain-nameservers).

10. Update [datoms.app nameservers](https://account.squarespace.com/domains/managed/datoms.app/dns/domain-nameservers).

11. Update [emulates.dev nameservers](https://account.squarespace.com/domains/managed/emulates.dev/dns/domain-nameservers).

12. Update [imageresizerservice.com nameservers](https://account.squarespace.com/domains/managed/imageresizerservice.com/dns/domain-nameservers).

13. Update [linkpage.app nameservers](https://account.squarespace.com/domains/managed/linkpage.app/dns/domain-nameservers).

14. Update [patchdb.dev nameservers](https://account.squarespace.com/domains/managed/patchdb.dev/dns/domain-nameservers).

15. Update [tabular.chat nameservers](https://account.squarespace.com/domains/managed/tabular.chat/dns/domain-nameservers).

16. Update [thehiccups.band nameservers](https://account.squarespace.com/domains/managed/thehiccups.band/dns/domain-nameservers).

17. Update [tripolar.band nameservers](https://account.squarespace.com/domains/managed/tripolar.band/dns/domain-nameservers).

18. Update [voteonit.app nameservers](https://account.squarespace.com/domains/managed/voteonit.app/dns/domain-nameservers).

19. Keep the existing nameservers and DNS records for these four domains:

    ```text
    chrisvouga.dev
    gamezilla.app
    moviefinder.app
    normalizer.app
    ```

20. In [Cloudflare](https://dash.cloudflare.com/), wait until all ten changed zones show **Active**.
    Allow **48 hours of stable Cloudflare delegation** before transferring them.

21. Check that [chrisvouga.dev](https://chrisvouga.dev) and [gamezilla.app](https://gamezilla.app) still work.

22. Choose one domain in [Squarespace Domains](https://account.squarespace.com/domains).
    Complete steps 23–30 for that domain, then repeat for all 14.

23. Switch **Domain Lock** to **Off**.

24. Click **Request transfer code**.
    Complete any password/MFA prompts, then click **OK**.

25. Open the domain's registrant mailbox, which may differ from your login email.
    Find the newest email from `no-reply@squarespace.com`:

    ```text
    Auth code for [domain]
    ```

    Allow up to 24 hours and check spam.
    [Squarespace's transfer instructions](https://support.squarespace.com/hc/en-us/articles/205812338-Transferring-a-domain-away-from-Squarespace).

26. Copy the newest transfer code.

27. Open [Cloudflare → Transfer domains](https://dash.cloudflare.com/?to=/:account/registrar/transfer).
    Select that domain and paste its code.

28. Review the transfer fee, expiration date and any registration-limit warning.
    Confirm your payment method is valid.

29. Confirm accurate registrant contact information and the registration terms.

30. Click **Confirm transfer** once.
    [Cloudflare's transfer instructions](https://developers.cloudflare.com/registrar/get-started/transfer-domain-to-cloudflare/).

31. Monitor [Cloudflare → Transfer domains](https://dash.cloudflare.com/?to=/:account/registrar/transfer) until all 14 complete.
    Complete required verification emails.
    Squarespace's **“New domain transfer request”** email may offer cancellation;
    leave that alone to let its five-day window expire.

32. Confirm all 14 registrations show correct expiration dates, auto-renew, privacy and transfer lock.

33. Recheck [chrisvouga.dev](https://chrisvouga.dev) and [gamezilla.app](https://gamezilla.app).
    Keep hosting and email subscriptions that are still used.

34. Run this read-only repository check:

    ```bash
    bun migrate-domains-to-cloudflare --audit
    ```

    Before resuming write-mode automation, adopt the transferred registrations into OpenTofu.
