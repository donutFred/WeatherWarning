# Weather Warning

This is a website to give advanced warning of weather that could be potentially damaging to caravans and campers.

Designed primarily for my caravan as I needed a less manual way of being notified of forecast wind gusts and other warnings that might cause me to do someting with the caravan such as put down the awning, or move to a new location!

If I know the wind gusts will be above a certain threshold in the next 7 days, I might not bother putting the awning up when I arrive at a site, and if I know the wind gusts will be very high, I need to plan when to pull down the awning during a break in the winds and preferably not when it's raining. Of course, what happens wihtout forward planning and weather knowledge is one minute the weather is nice and sunny and warm with little wind, next it starts to rain and the wind picks up. By the time the wind is strong enough that I worry about damaging my caravan awning, it's usually dark outside, cold and raining - as well as the wind!

There are plenty of apps to do each of these tasks, but I found nothing that did it all, so unless I was payign attention and had enough time to do all this manually, I'd end up in the situation where I was putting down my awning in the cold, dark and wet!

Then I thought it would be great if I got an alert that wind was forecast and i needed to do something and I could just react when I was warned!

Note, this is my first intro to coding since 1995 other than Excel Visual Basic!
Go easy on me please :)

For now this is the basic website javascript version - I'm hoping that an iPhone app version or widget will happen next.

To run:
python3 serve_https.py 8082
(or whatever port you choose)
then open in your browser at https://localhost:8082

## iPhone geolocation fix (not localhost)

iPhone Safari blocks location on plain HTTP. Use your deployed HTTPS domain instead of a LAN IP URL.

Current custom domain in this repo:

https://myawningwarning.disruptivemining.tech

If HTTPS is not working yet, configure GitHub Pages:

1. Push your latest changes to `main`.
2. In GitHub repo settings, open **Pages**.
3. Set source to deploy from `main` (root) if not already set.
4. Set Custom domain to `myawningwarning.disruptivemining.tech`.
5. Wait for DNS check to pass, then enable **Enforce HTTPS**.
6. Wait a few minutes for certificate provisioning, then open the HTTPS URL on iPhone.

Important: geolocation will still fail on iPhone if the TLS certificate does not match your custom domain.
