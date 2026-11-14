# دليل الإطلاق خطوة بخطوة (لومن جروث)

الدليل ده مكتوب لحد مش مبرمج. امشي على الخطوات بالترتيب، وكل أمر مكتوب في مربع رمادي انسخه زي ما هو والصقه في الـ Terminal.

> **مهم:** أي حاجة مكتوب جنبها **(يُؤكَّد)** معناها إننا مش متأكدين منها 100% ولازم تتأكد منها من الجهة نفسها (Paymob أو Meta أو المحامي). القوانين والشروط بتتغير.

---

## 0) الصورة الكبيرة

التطبيق متقسم 3 حتت:

| الحتة | بتعمل إيه | فين |
|---|---|---|
| الواجهة (Frontend) | الموقع اللي العميل بيشوفه | Vercel (أو Netlify) |
| Supabase | تسجيل الدخول + قاعدة البيانات + "Edge Functions" (الكود اللي بيكلم Paymob وMeta) | supabase.com |
| Paymob و Meta | الدفع، وبيانات الإعلانات | حسابات باسمك |

**الوضع الحالي (Closed Beta):** لأن لسه مفيش شركة مسجلة:
- تطبيق Meta هيفضل في **Development mode**: بس الناس اللي تضيفهم كـ **Testers** يقدروا يربطوا حساباتهم الإعلانية.
- Paymob ممكن مايوافقش دلوقتي، فالدفع هيبقى **يدوي** (إنستاباي / فودافون كاش) وإنت تفعّل الاشتراك من صفحة `/admin`.
- لما الشركة تتسجل: تعمل Business Verification وApp Review في Meta، وتفعّل Paymob، **من غير ما تغيّر ولا سطر كود**.

**قبل ما تبدأ محتاج:**
- كمبيوتر عليه [Node.js 20 أو أحدث](https://nodejs.org) (نزّل نسخة LTS).
- حساب GitHub (علشان Vercel ياخد الكود منه).
- إيميل خاص بالمشروع (مثلاً support@your-domain).

افتح الـ Terminal في فولدر المشروع واكتب مرة واحدة:

```bash
npm install
```

تقدر تشوف التطبيق شغال ببيانات تجريبية من غير أي إعداد:

```bash
npm run dev
```

وافتح `http://localhost:5173` في المتصفح.

---

## 1) Supabase: قاعدة البيانات وتسجيل الدخول

### 1.1 اعمل المشروع
1. ادخل [supabase.com](https://supabase.com) واعمل حساب.
2. **New project**. اختار اسم (مثلاً `lumen-growth`)، باسورد قوي لقاعدة البيانات (احفظه عندك)، والمنطقة **Frankfurt (eu-central-1)** لأنها الأقرب لمصر والخليج.
3. استنى دقيقتين لحد ما المشروع يجهز.
4. من **Project Settings → General** انسخ **Reference ID** (حروف زي `abcdefghijklmnop`). هنسميه `PROJECT_REF`.
5. من **Project Settings → API** انسخ:
   - **Project URL** (زي `https://abcdefghijklmnop.supabase.co`)
   - **anon / publishable key** (المفتاح العام، عادي إنه يبان في المتصفح)
   - **متنسخش الـ service_role key في أي مكان في الواجهة أبدًا.**

### 1.2 اربط المشروع وشغّل الـ migrations
في الـ Terminal (من فولدر المشروع):

```bash
npx supabase login
npx supabase link --project-ref PROJECT_REF
npx supabase db push
```

- `login` هيفتح المتصفح علشان توافق.
- `link` هيسألك على باسورد قاعدة البيانات.
- `db push` بيعمل كل الجداول والصلاحيات (RLS) والباقات (مجاني، ستارتر 999، جروث 2,499، إيجنسي 6,999 جنيه).

### 1.3 السكريتس (المفاتيح السرية) ونشر الـ Functions
1. انسخ الملف `supabase/functions/.env.example` لملف جديد اسمه `supabase/functions/.env` (الملف ده مش بيترفع على GitHub).
2. املاه. لو لسه معندكش مفاتيح Paymob أو Meta سيب القيم التجريبية دلوقتي وارجعله بعدين:
   - `APP_URL` = رابط موقعك من غير `/` في الآخر (في الأول ممكن `http://localhost:5173`، وبعد Vercel غيّره).
   - `CRON_SECRET` = أي كلام عشوائي طويل (للمزامنة اليومية).
3. ارفع السكريتس:

```bash
npx supabase secrets set --env-file supabase/functions/.env
```

4. انشر الـ Functions (كل سطر لوحده):

```bash
npx supabase functions deploy paymob-checkout
npx supabase functions deploy meta-oauth-callback
npx supabase functions deploy admin-activate
npx supabase functions deploy meta-create-ad
npx supabase functions deploy paymob-webhook --no-verify-jwt
npx supabase functions deploy meta-sync --no-verify-jwt
```

> `--no-verify-jwt` للـ webhook علشان Paymob مش بيبعت تسجيل دخول Supabase؛ الحماية بتبقى بالـ HMAC. ولـ meta-sync علشان المزامنة اليومية؛ الكود نفسه بيتأكد من المستخدم أو من `CRON_SECRET`.

كل ما تغيّر سكريت، شغّل أمر `secrets set` تاني (مش محتاج تعيد النشر).

### 1.4 إعدادات تسجيل الدخول
في Supabase: **Authentication → URL Configuration**:
- **Site URL:** رابط موقعك (مثلاً `https://app.your-domain.com`).
- **Redirect URLs:** ضيف:
  - `https://app.your-domain.com/**`
  - `http://localhost:5173/**` (للتجربة على جهازك)

**الدخول بالإيميل (Magic link):** شغال لوحده. لكن Supabase المجاني بيبعت عدد قليل جدًا من الإيميلات في الساعة، فقبل الإطلاق:
- **Authentication → Emails → SMTP Settings** واربطه بخدمة إيميل (مثلاً Resend أو Brevo أو Amazon SES).
- (اختياري) عدّل نص الإيميل في **Email Templates** وخليه عربي.

**الدخول بجوجل:**
1. ادخل [console.cloud.google.com](https://console.cloud.google.com) → اعمل مشروع → **APIs & Services → OAuth consent screen** (اكتب اسم التطبيق والإيميل ورابط الخصوصية).
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. في **Authorized redirect URIs** حط: `https://PROJECT_REF.supabase.co/auth/v1/callback`
4. خد **Client ID** و**Client secret** وحطهم في Supabase: **Authentication → Sign In / Providers → Google** وفعّله.

### 1.5 (اختياري بس مهم) مزامنة يومية تلقائية وقفل الاشتراكات المنتهية
من Supabase: **Database → Extensions** فعّل `pg_cron` و`pg_net`. بعدين **SQL Editor** والصق (غيّر `PROJECT_REF` و`CRON_SECRET`):

```sql
select cron.schedule(
  'lumen-meta-sync-daily', '0 4 * * *',
  $$ select net.http_post(
       url := 'https://PROJECT_REF.supabase.co/functions/v1/meta-sync',
       headers := '{"Content-Type":"application/json","x-cron-secret":"CRON_SECRET"}'::jsonb,
       body := '{}'::jsonb) $$
);

select cron.schedule('lumen-expire-subscriptions', '30 0 * * *', $$ select public.expire_lapsed_subscriptions() $$);
```

(من غير الخطوة دي، العميل يقدر يضغط "زامن الآن" بنفسه من صفحة ربط ميتا، والتطبيق بيقفل الاشتراك المنتهي تلقائيًا في الواجهة برضه.)

---

## 2) تطبيق Meta (فيسبوك)

### 2.1 اعمل التطبيق
1. ادخل [developers.facebook.com](https://developers.facebook.com) بحساب فيسبوك بتاعك → **My Apps → Create App**.
2. اختار نوع / use case يسمح بـ **Marketing API** و**Facebook Login** (غالبًا "Other" وبعدين **Business**). **(يُؤكَّد: أسماء الاختيارات بتتغير في واجهة Meta.)**
3. من **App settings → Basic**:
   - انسخ **App ID** و**App Secret** وحطهم في `supabase/functions/.env` (`META_APP_ID` و`META_APP_SECRET`) وارفع السكريتس تاني (خطوة 1.3).
   - حط **App ID** كمان في متغير الواجهة `VITE_META_APP_ID`.
   - **Privacy Policy URL:** `https://app.your-domain.com/legal/privacy.html` (بعد ما تعدّل الصفحة، شوف قسم 6).
   - **Terms of Service URL:** `https://app.your-domain.com/legal/terms.html`
   - **User data deletion:** حط رابط صفحة الخصوصية (فيها تعليمات الحذف) أو إيميل الدعم.
   - **App icon** و**Category** و**App domains** (`your-domain.com`).
4. ضيف منتج **Facebook Login** (أو **Facebook Login for Business**) → **Settings**:
   - **Valid OAuth Redirect URIs:** `https://app.your-domain.com/app/connect`
   - لازم يكون نفس `APP_URL` + `/app/connect` بالظبط، وإلا الربط هيفشل.
   - **(يُؤكَّد)** لو Meta جبرتك تستخدم "Facebook Login for Business" بـ *Configuration ID* بدل الـ scopes، ابعتلنا ونغيّر سطر واحد في `supabase/functions/_shared/meta.ts`.
5. ضيف منتج **Marketing API**.

### 2.2 ضيف العملاء كـ Testers (ده المهم في الـ Beta)
طول ما التطبيق في **Development mode**، محدش يقدر يربط حسابه غير اللي ليهم دور على التطبيق:
1. **App roles → Roles → Add People → Testers**.
2. اكتب اسم أو ID حساب فيسبوك بتاع العميل (الحساب اللي بيدخل بيه Ads Manager).
3. العميل لازم **يقبل الدعوة** من [developers.facebook.com/requests](https://developers.facebook.com/requests) (ممكن يحتاج يسجل كـ Meta Developer الأول، تسجيل بسيط ومجاني).
4. بعدها يدخل التطبيق → **ربط ميتا** → يوافق → يختار الحسابات الإعلانية.

> الـ Access token بيعيش حوالي 60 يوم. التطبيق بيعرض تاريخ الانتهاء في صفحة "ربط ميتا"، والعميل يضغط "إعادة الربط" قبله.

### 2.2.1 إنشاء الإعلانات من جوه لومن (صفحة «إنشاء إعلان»)

البرنامج دلوقتي بيطلب من ميتا ٤ صلاحيات وقت الربط:

| الصلاحية | بنستخدمها في إيه |
|---|---|
| `ads_read` | قراءة الحسابات والأرقام (اللوحة والتنبيهات والتوصيات) |
| `ads_management` | إنشاء حملة ومجموعة إعلانات وإعلان |
| `pages_show_list` | عرض صفحات فيسبوك اللي الإعلان هيظهر باسمها |
| `pages_read_engagement` | قراءة بيانات الصفحة عشان الإعلان يتنشر باسمها |

- في **Development mode** الصلاحيات دي بتشتغل من غير مراجعة، بس للناس اللي ليهم دور على التطبيق (Admin / Developer / Tester).
- أي عميل ربط قبل التحديث ده لازم **يربط ميتا تاني** عشان يدي الصلاحيات الجديدة، وإلا هتظهرله رسالة «اربط ميتا تاني».
- كل حاجة بتتعمل **متوقفة (PAUSED)**. مفيش أي صرف لحد ما العميل يشغّلها بنفسه من Ads Manager.
- الميزة متاحة في باقات **Growth** و**Agency** (وفي التجربة المجانية). لو قاعدة البيانات اتعملت قبل التحديث، شغّل في SQL Editor الملف `supabase/migrations/20261115000001_create_ads.sql`.
- انشر الـ Function الجديدة: `npx supabase functions deploy meta-create-ad`
- للبيع المفتوح لازم **Advanced Access** لـ `ads_management` و`pages_show_list` و`pages_read_engagement` كمان، مش `ads_read` بس (شوف 2.3). ومراجعة `ads_management` أصعب، فجهّز فيديو بيوضح إنشاء الإعلان خطوة بخطوة.

### 2.3 لما الشركة تتسجل: Business Verification و App Review
علشان أي حد (مش بس الـ testers) يقدر يربط، محتاج تقلب التطبيق **Live** وتاخد **Advanced Access** لصلاحية `ads_read`. ده هيحتاج:

**Business Verification (توثيق النشاط التجاري)** من [business.facebook.com](https://business.facebook.com) → Security Center:
- اسم الشركة القانوني زي ما هو في السجل التجاري بالظبط.
- مستند رسمي: **السجل التجاري** و/أو **البطاقة الضريبية** **(يُؤكَّد: Meta بتحدد المستندات المقبولة لكل دولة).**
- إثبات عنوان أو رقم تليفون باسم الشركة (فاتورة مرافق أو كشف حساب بنكي).
- دومين باسمك وإيميل على نفس الدومين، وممكن يطلبوا **Domain verification**.

**App Review لـ `ads_read` (Advanced Access):**
- وصف واضح بالإنجليزي إزاي بتستخدم البيانات (قراءة فقط لعرض الأداء للمعلن نفسه).
- **فيديو Screencast** بيوري: تسجيل الدخول → ربط ميتا → اختيار الحساب → ظهور البيانات في اللوحة.
- رابط سياسة الخصوصية شغال وفيه تعليمات حذف البيانات.
- حساب تجربة للمراجع (إيميل وباسورد) أو تعليمات الدخول.
- **(يُؤكَّد)** ممكن يطلبوا كمان **Ads Management Standard Access** لحدود استخدام أعلى للـ Marketing API.

بعد الموافقة: **App Mode → Live**. مفيش تغيير في الكود.

---

## 3) Paymob (الدفع الأونلاين)

### 3.1 فتح الحساب
1. سجّل من [paymob.com](https://paymob.com) (Accept). هتلاقي حساب **Test** تقدر تجرب بيه فورًا.
2. علشان تاخد **Live** (فلوس حقيقية) Paymob بتطلب أوراق (KYC). المتوقع **(يُؤكَّد مع Paymob، خصوصًا لو هتفتح كفرد مش شركة):**
   - **للشركات:** سجل تجاري ساري، بطاقة ضريبية، بطاقة رقم قومي للمالك/المدير المسؤول، عقد تأسيس أو صحيفة الشركات، بيانات حساب بنكي باسم الشركة (خطاب من البنك).
   - **للأفراد / فريلانسر:** بطاقة رقم قومي، حساب بنكي باسمك، وأحيانًا بطاقة ضريبية أو إثبات نشاط **(يُؤكَّد: هل Paymob بيقبل أفراد لخدمة اشتراكات SaaS ولا لأ).**
   - موقع شغال فيه: الأسعار بالجنيه، الشروط والأحكام، سياسة الخصوصية، **سياسة الاسترداد**، وبيانات التواصل. (الصفحات دي موجودة كمسودة في المشروع، شوف قسم 6.)
3. اطلب تفعيل وسائل الدفع: **كارت**، **محافظ الموبايل** (فودافون كاش وغيرها)، و**فوري** (Kiosk) **(يُؤكَّد: فوري متاحة في Unified Checkout ولا محتاجة تكامل منفصل).**

### 3.2 المفاتيح والإعدادات
من لوحة Paymob:
1. **Settings / Developers** (أو API keys): انسخ **Secret key** و**Public key** و**HMAC secret**.
2. **Payment Integrations**: انسخ **Integration ID** لكل وسيلة دفع (كارت، محفظة، فوري…). حطهم مفصولين بفاصلة في `PAYMOB_INTEGRATION_IDS`.
3. في إعدادات كل Integration:
   - **Transaction processed callback:** `https://PROJECT_REF.supabase.co/functions/v1/paymob-webhook`
   - **Transaction response callback:** `https://app.your-domain.com/app/billing?checkout=done`
4. حط القيم في `supabase/functions/.env` وارفع السكريتس:

```bash
npx supabase secrets set --env-file supabase/functions/.env
```

5. **جرّب بمفاتيح Test الأول** (كروت تجريبية من صفحة Paymob). اتأكد إن الدفع نجح والباقة اتفعلت في صفحة الاشتراك.
6. لما تاخد Live: بدّل المفاتيح وIntegration IDs بتوع Live، وفي Vercel خلي `VITE_PAYMOB_ENABLED=true` وأعد النشر. قبل كده الزرار بيظهر مقفول ومكتوب إن الدفع الأونلاين قريب.

> **الحماية:** الـ webhook بيتأكد من توقيع HMAC قبل أي حاجة، وبيقارن المبلغ والعملة بالمطلوب، ولو Paymob بعت نفس العملية مرتين مش بيمد الاشتراك مرتين.

### 3.3 الدفع اليدوي لحد ما Paymob يوافق (إنستاباي / فودافون كاش)
1. في Vercel حط:
   - `VITE_MANUAL_INSTAPAY` = عنوان إنستاباي بتاعك (مثلاً `name@instapay`)
   - `VITE_MANUAL_WALLET` = رقم فودافون كاش
   - `VITE_SUPPORT_WHATSAPP` = رقم واتساب بالصيغة الدولية من غير + (مثلاً `2010XXXXXXXX`)
2. العميل بيشوف التعليمات دي في صفحة **الاشتراك والدفع** مع **رقم مساحة العمل** بتاعته.
3. لما يبعتلك صورة التحويل: ادخل `/admin` → دوّر على مساحة العمل → **تفعيل** → اختار الباقة وعدد الشهور وطريقة الدفع واكتب **رقم مرجع التحويل** → **تأكيد التفعيل**.
   - الاشتراك بيتمد 30 يوم لكل شهر. لو لسه فيه أيام فاضلة بتتضاف عليها.
   - نفس رقم المرجع مينفعش يتستخدم مرتين (حماية من التفعيل المكرر).

---

## 4) النشر على Vercel بدومين خاص

1. ارفع المشروع على GitHub (Repository **Private**).
2. ادخل [vercel.com](https://vercel.com) بحساب GitHub → **Add New → Project** → اختار الـ repo.
3. الإعدادات (غالبًا بيكتشفها لوحده): Framework **Vite**، Build command `npm run build`، Output `dist`.
4. **Environment Variables** (من `.env.example`):
   - `VITE_SUPABASE_URL` = Project URL من Supabase
   - `VITE_SUPABASE_ANON_KEY` = المفتاح العام (anon / publishable)
   - `VITE_META_APP_ID` = App ID بتاع Meta
   - `VITE_PAYMOB_ENABLED` = `false` لحد ما Paymob يوافق
   - `VITE_MANUAL_INSTAPAY`، `VITE_MANUAL_WALLET`، `VITE_SUPPORT_WHATSAPP`
   - **ممنوع** تحط أي Secret key هنا (لا Paymob ولا Meta App Secret ولا service_role).
5. **Deploy**.
6. **الدومين:** اشتري دومين (مثلاً من Namecheap أو Cloudflare). في Vercel: **Settings → Domains → Add** واكتب `app.your-domain.com`، وVercel هيقولك تعمل سجل **CNAME** عند شركة الدومين يشاور على `cname.vercel-dns.com`. استنى لحد ما يبقى "Valid".
7. **بعد الدومين حدّث 3 أماكن بالرابط الجديد:**
   - `APP_URL` في `supabase/functions/.env` وارفع السكريتس.
   - Supabase → Authentication → URL Configuration (Site URL وRedirect URLs).
   - Meta → Facebook Login → Valid OAuth Redirect URIs (`https://app.your-domain.com/app/connect`).
   - وPaymob callbacks لو كنت حاططها.

> Netlify بديل شغال برضه: الملف `public/_redirects` جاهز.

**تجربة من غير سيرفر:** أي رابط فيه `?demo` (مثلاً `https://app.your-domain.com/app?demo`) بيفتح نسخة تجريبية ببيانات وهمية، مفيدة للعرض على العملاء.

---

## 5) خلّي نفسك Platform Admin

1. ادخل موقعك وسجّل حساب عادي بإيميلك (هيتعمل لك مساحة عمل وتجربة 14 يوم).
2. في Supabase → **SQL Editor** شغّل (غيّر الإيميل):

```sql
update public.profiles set is_platform_admin = true where email = 'you@your-domain.com';
```

3. اعمل Refresh. هيظهر لك **الإدارة** في القائمة، وتقدر تفتح `/admin`.

> المستخدم العادي مستحيل يدي نفسه الصلاحية دي: قاعدة البيانات مانعة تعديل العمود ده من المتصفح.

---

## 6) Checklist قانوني مختصر (راجعه مع محامي)

- [ ] **الشروط والأحكام** (`public/legal/terms.html`): اسمك/اسم الشركة، طبيعة الخدمة، التجديد كل 30 يوم، التجربة المجانية، حدود المسؤولية، القانون الحاكم.
- [ ] **سياسة الخصوصية** (`public/legal/privacy.html`): **Meta بتطلب رابطها إجباري**. لازم تقول إيه البيانات اللي بتاخدها من Meta (قراءة فقط عن طريق `ads_read`)، بتستخدمها في إيه، فين متخزنة، وإزاي العميل يطلب **حذف بياناته**.
- [ ] **سياسة الاسترداد** (`public/legal/refunds.html`): Paymob والبنوك بيطلبوها. حدد المدة وطريقة الاسترداد.
- [ ] بيانات تواصل واضحة (إيميل + واتساب) في الموقع.
- [ ] الأسعار ظاهرة بالجنيه وموضح إنها شاملة أو غير شاملة الضريبة **(يُؤكَّد مع محاسب: ضريبة القيمة المضافة على الخدمات الرقمية بعد تسجيل الشركة).**
- [ ] لما تبيع في الخليج: أسعار بالدرهم/الريال (تتضاف كباقات جديدة من غير تغيير كود) ومراجعة متطلبات كل دولة **(يُؤكَّد).**
- [ ] الصفحات الحالية **مسودات** فيها `[...]` لازم تملاها.

---

## 7) قبل ما تدعو أول عميل

- [ ] سجّلت حساب جديد ولقيت تجربة 14 يوم ظاهرة في صفحة الاشتراك.
- [ ] أضفت نفسك Tester وربطت حساب إعلاني وضغطت "زامن الآن" والبيانات ظهرت.
- [ ] حددت ميزانية شهرية لكام حملة من **الإعدادات** وصفحة **وتيرة الميزانية** اشتغلت.
- [ ] جربت تفعيل يدوي من `/admin` على حساب تجريبي.
- [ ] (لو Paymob Test جاهز) دفعت بكارت تجريبي والباقة اتفعلت.
- [ ] جربت الموقع على الموبايل بالعربي والإنجليزي.

## مشاكل شائعة

| المشكلة | الحل |
|---|---|
| "redirect_uri_mismatch" في ربط ميتا | `APP_URL` + `/app/connect` لازم يطابق بالظبط اللي في Meta واللي في المتصفح (https، من غير `/` زيادة). |
| العميل بيدوس "الربط مع فيسبوك" ويطلع له خطأ إن التطبيق مش متاح | لسه مش Tester أو مقبلش الدعوة (قسم 2.2). |
| إيميل الدخول مش بيوصل | فعّل SMTP (قسم 1.4) وشوف الـ Spam. |
| الدفع نجح والباقة متغيرتش | شوف Supabase → Edge Functions → paymob-webhook → Logs. غالبًا `PAYMOB_HMAC_SECRET` غلط أو الـ callback URL مش متظبط. |
| "plan_limit_ad_accounts" | العميل اختار حسابات أكتر من باقته. يرقّي الباقة أو يشيل حساب. |
