# Teable + Shopify Sync: Oracle Free Server Setup Guide

Oct 24, 2026

## Ye guide kya banayegi

Is guide ke end tak ek free Oracle server pe do cheezein chal rahi hongi: **Teable** (aapka sites ka database) aur **sync script** (jo har 20 minute mein Teable check karke nayi ya badli sites Shopify pe bhej deti hai). Pehli baar poora setup karne mein lagbhag **3-4 ghante** lagenge, aur 189,156 products Shopify pe jaane mein uske upar kuch ghante aur.

![Setup ka naksha: 1 server, 4 hisse, Shopify](images/architecture.png)

Aap Teable browser se kholte ho. Sync script har 20 minute mein Teable se nayi aur badli hui sites padh ke Shopify products banata ya update karta hai.

Koi coding nahi aani chahiye. Har step mein bas **click karna** ya **command copy-paste karna** hai. Commands jaise likhi hain bilkul waise hi chalani hain, sirf `<...>` wale hisse apni value se badalne hain.

### Shuru karne se pehle ye taiyaar rakho

- [ ] Ek **Windows laptop** jisme ye repo (`01wire-catalog-sync`) aur cleaned data (`01-wire\data\clean`) hai
- [ ] Ek **email ID** aur **debit/credit card** (Oracle sirf verify karta hai, free limits mein paisa nahi katta)
- [ ] **Shopify store ka owner login**
- [ ] Jahan `01wire.com` ka **domain DNS** manage hota hai (GoDaddy, Cloudflare, Hostinger wagairah) uska login
- [ ] Ek **password manager** ya safe notebook, jisme har token/password likhte jaoge (aakhri section mein poori list hai)

### Kuch shabdon ka matlab

| Shabd | Simple matlab |
| --- | --- |
| Server / VM | Internet pe ek computer jo 24 ghante chalta hai |
| SSH | Apne laptop se us server pe commands chalane ka tareeka |
| Docker | Ek tool jo Teable ko ek "dibbe" mein chalata hai, taaki install aasaan ho |
| Token | Ek lamba password jo ek program ko doosre program mein ghusne deta hai |
| `.env` file | Ek text file jisme saare tokens aur settings likhe hote hain |
| Cron | Server ka alarm clock, jo tay time pe command chala deta hai |

## Part 1: Oracle Cloud ka free account banao

Oracle ka "Always Free" plan ek free server deta hai jo hamesha free rehta hai. Ye part lagbhag **20 minute** ka hai.

1. Browser mein **cloud.oracle.com** kholo aur **Sign up** / **Start for free** pe click karo.
2. Naam, email, country (**India**) bharo. Email pe aaya link kholo.
3. **Home Region** chunna padega. **Ye baad mein kabhi nahi badalta**, aur free server sirf isi region mein milta hai.
   - India ke liye **India West (Mumbai)** ya **India South (Hyderabad)** chuno.
4. Password banao, phone number aur address bharo.
5. Card details daalo. Oracle chhota sa amount hold karke wapas kar deta hai, ye sirf verification hai.
6. Account banne mein 5-15 minute lagte hain. Email aayega "Your account is ready". Phir **cloud.oracle.com** pe login karo.

### Zaroori: account ko "Pay As You Go" pe upgrade karo

Free account mein Oracle aapka server **band kar sakta hai** agar wo kuch din kam use ho. Upgrade karne se ye khatra hat jaata hai. **Free limits ke andar ek rupaya nahi katega.**

1. Login ke baad upar-right menu → **Billing & Cost Management** → **Upgrade and Manage Payment**.
2. **Pay As You Go** pe click karke upgrade karo.
3. Approval mein kuch ghante lag sakte hain. Tab tak aage ke steps kar sakte ho.

> Safety ke liye: **Billing → Budgets** mein ek budget banao, amount **₹100**, aur alert apni email pe lagao. Galti se koi paid cheez ban gayi to turant email aa jaayega.

**Note karo:** Oracle login email + password, aur aapka Home Region.

## Part 2: Free server (VM) banao

Hum Oracle ka sabse bada free server lenge: **4 CPU, 24 GB RAM, 100 GB disk**. Ye part **15 minute** ka hai.

1. Oracle Console mein upar-left **☰ menu** → **Compute** → **Instances** → **Create instance**.
2. **Name:** `teable-server`
3. **Image and shape** → **Edit**:
   - **Change image** → **Ubuntu** → **Canonical Ubuntu 24.04** → Select.
   - **Change shape** → **Ampere** → **VM.Standard.A1.Flex** tick karo → **OCPUs: 4**, **Memory: 24 GB** → Select.
   - Shape ke saath **"Always Free-eligible"** likha hona chahiye. Nahi likha to ruk jao, kuch galat chuna hai.
4. **Networking:** "Create new virtual cloud network" aur "Create new public subnet" rehne do. **"Automatically assign public IPv4 address"** ON hona chahiye.
5. **Add SSH keys:** **"Generate a key pair for me"** chuno → **Save private key** dabao.
   - Ek file download hogi (jaise `ssh-key-2026-10-24.key`). **Ye server ki chaabi hai.** Ise `C:\Users\<aapka-naam>\.ssh\oracle.key` naam se rakh do. Ye kho gayi to server mein ghus nahi paoge.
6. **Boot volume:** "Specify a custom boot volume size" tick karo → **100 GB**.
7. **Create** dabao. 1-2 minute mein status **RUNNING** (hara) ho jaayega.
8. Instance page pe **Public IP address** dikhega (jaise `141.148.x.x`). **Ise note karo.** Aage har jagah `<SERVER-IP>` likha ho to yahi daalna.

> **"Out of capacity" error aaye?** Ye aam hai, Oracle ke free ARM servers kabhi kabhi khatam ho jaate hain. Kuch ghante baad ya agle din dobara try karo. Pay As You Go upgrade hone ke baad ye error kam aata hai.

**Note karo:** Server ka Public IP, aur SSH key file kahan rakhi.

## Part 3: Server ke darwaze kholo aur domain jodo

Teable ko browser mein `https://teable.01wire.com` jaise address pe kholna hai. Iske liye do kaam: Oracle mein **port 80 aur 443** kholna (web ke darwaze), aur domain ko server ki taraf point karna. Ye part **10 minute** ka hai.

> Pehle Teable `http://46.224.66.162:3001` jaise IP:port pe chal raha tha, aur import mein "fetch failed" aaya tha. Proper domain + HTTPS lagane se wo dikkat bhi nahi aayegi.

### 3A. Oracle mein port 80 aur 443 kholo

1. **Compute → Instances → teable-server** kholo.
2. **Primary VNIC** section mein **Subnet** ke naam pe click karo.
3. **Security** tab (ya **Security Lists**) → **Default Security List** pe click karo.
4. **Add Ingress Rules** dabao aur bharo:
   - **Source CIDR:** `0.0.0.0/0`
   - **IP Protocol:** TCP
   - **Destination Port Range:** `80,443`
5. **Add Ingress Rules** dabao. Port 22 (SSH) pehle se khula hota hai, use mat chhedna.

Server ke andar bhi ek firewall hai. Use Part 4 mein command se kholenge.

### 3B. Domain ko server se jodo

1. Jahan `01wire.com` ka DNS hai (GoDaddy / Cloudflare / Hostinger), wahan login karo → **DNS Records / Manage DNS**.
2. Naya record banao:

| Type | Name / Host | Value / Points to | TTL |
| --- | --- | --- | --- |
| A | `teable` | `<SERVER-IP>` | Default |

3. Save karo. **Cloudflare** hai to record ke saamne narangi badal ko **grey (DNS only)** kar do.
4. 5-30 minute mein `teable.01wire.com` aapke server pe point karne lagega.

> Domain nahi lagana? Ho sakta hai, par HTTPS nahi milega aur pehle wali "fetch failed" dikkat wapas aa sakti hai. Isliye domain lagana hi theek hai.

**Note karo:** Teable ka address, jaise `teable.01wire.com`.

## Part 4: Laptop se server se judo aur zaroori software daalo

Ab aap laptop se server pe commands chalaoge. Ye part **20 minute** ka hai.

### 4A. Server se judo (SSH)

1. Windows mein **Start** dabao, **PowerShell** likho, kholo.
2. Key file ko safe banao (Windows isske bina key nahi chalne deta). Ye do lines copy-paste karo:

```powershell
icacls "$env:USERPROFILE\.ssh\oracle.key" /inheritance:r
icacls "$env:USERPROFILE\.ssh\oracle.key" /grant:r "$($env:USERNAME):(R)"
```

3. Server se judo (`<SERVER-IP>` badalna mat bhoolna):

```powershell
ssh -i "$env:USERPROFILE\.ssh\oracle.key" ubuntu@<SERVER-IP>
```

4. Pehli baar ek sawal aayega `Are you sure you want to continue connecting?` → `yes` likho, Enter.
5. Ab line kuch aisi dikhegi: `ubuntu@teable-server:~$`. **Matlab aap server ke andar ho.** Aage ki saari commands yahin chalani hain.

> Har baar server pe kaam karna ho, to step 1 aur 3 dobara karo. Step 2 sirf ek baar.

### 4B. Server ka firewall kholo aur software daalo

Ye commands **ek-ek karke** copy-paste karo. Har command ke khatam hone ka intezaar karo (wapas `ubuntu@teable-server:~$` dikhe).

```bash
sudo apt update && sudo DEBIAN_FRONTEND=noninteractive apt upgrade -y
```

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
```

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Ab `exit` likho, Enter. Phir 4A ka step 3 dobara karke server pe wapas judo. (Docker ki permission naye login pe hi lagti hai.)

### 4C. Check karo sab install hua

```bash
docker --version
node -v
python3 --version
```

Teeno ek version number dikhaye (jaise `Docker version 28...`, `v22...`, `Python 3.12...`) to sab theek hai. Koi error aaye to aakhri section "Dikkat aaye to" dekho.

## Part 5: Teable install karo

Teable teen dibbon (Docker containers) mein chalega: **Teable** khud, uska **database** (Postgres), aur **Caddy** jo HTTPS (taala wala link) apne aap lagata hai. Ye part **15 minute** ka hai. Saari commands server pe chalani hain (Part 4A se judo).

### 5A. Settings file banao

Pehli line mein agar aapka domain alag hai to `teable.01wire.com` badal do, phir **poora block ek saath** copy-paste karo. Ye database ka password aur secret key apne aap bana deta hai.

```bash
DOMAIN=teable.01wire.com
mkdir -p ~/teable && cd ~/teable
DB_PASS=$(openssl rand -hex 16)
SECRET=$(openssl rand -hex 32)
cat > .env <<EOF
TEABLE_DOMAIN=$DOMAIN
PUBLIC_ORIGIN=https://$DOMAIN
POSTGRES_HOST=teable-db
POSTGRES_PORT=5432
POSTGRES_DB=teable
POSTGRES_USER=teable
POSTGRES_PASSWORD=$DB_PASS
PRISMA_DATABASE_URL=postgresql://teable:$DB_PASS@teable-db:5432/teable
SECRET_KEY=$SECRET
EOF
cat > Caddyfile <<EOF
$DOMAIN {
    reverse_proxy teable:3000
}
EOF
echo "Done"
```

### 5B. Docker file banao

Ye block bhi poora ek saath copy-paste karo:

```bash
cat > ~/teable/docker-compose.yml <<'EOF'
services:
  teable:
    image: ghcr.io/teableio/teable:latest
    restart: always
    env_file: .env
    environment:
      - NEXT_ENV_IMAGES_ALL_REMOTE=true
    volumes:
      - teable-data:/app/.assets
    ports:
      - "127.0.0.1:3000:3000"
    extra_hosts:
      - "${TEABLE_DOMAIN}:host-gateway"
    depends_on:
      teable-db:
        condition: service_healthy
  teable-db:
    image: postgres:15.4
    restart: always
    environment:
      - POSTGRES_DB=${POSTGRES_DB}
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - teable-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 3s
      retries: 5
  caddy:
    image: caddy:2
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
volumes:
  teable-data:
  teable-db:
  caddy-data:
EOF
echo "Done"
```

> `extra_hosts` wali line ka kaam: Teable server ko apne hi domain tak seedha pahuncha deti hai. Pichli baar "fetch failed" error isi wajah se aaya tha.

### 5C. Teable chalu karo

```bash
cd ~/teable && docker compose up -d
```

Pehli baar 2-5 minute lagenge (images download hongi). Phir check karo:

```bash
docker compose ps
```

Teeno (`teable`, `teable-db`, `caddy`) ke saamne **Up** / **running** likha hona chahiye.

### 5D. Pehla login

1. Browser mein `https://teable.01wire.com` kholo. Taala (🔒) dikhna chahiye.
2. **Sign up** karo apni email aur ek strong password se. Ye aapka admin account hai.
3. Login ke baad, agar **Settings / Admin** mein "Allow sign up" jaisa option dikhe, to use **band** kar do, taaki koi aur account na bana sake.

### 5E. Passwords save karo

```bash
cat ~/teable/.env
```

Jo dikhe use apne password manager mein **"Teable server .env"** naam se save karo. **Ye file kabhi kisi ko mat bhejna.**

**Note karo:** Teable login email + password, aur `.env` ka content.

## Part 6: Teable mein table banao aur 189,156 sites daalo

Pehle 100 sites browser se import karke table banayenge (isse saare 47 columns ban jaate hain), phir baaki sites script se daalenge. Browser se badi files import karne pe 500 error aata hai, isliye script. Ye part **30 minute** ka hai.

### 6A. Files server pe bhejo

Laptop pe ek **naya PowerShell** kholo (server wala nahi). Ye commands chalao, `<SERVER-IP>` badal ke:

```powershell
ssh -i "$env:USERPROFILE\.ssh\oracle.key" ubuntu@<SERVER-IP> "mkdir -p ~/data"
scp -i "$env:USERPROFILE\.ssh\oracle.key" -r "C:\shreyians\side quests\01wire-catalog-sync\catalog-tools" ubuntu@<SERVER-IP>:~/
scp -i "$env:USERPROFILE\.ssh\oracle.key" -r "C:\shreyians\side quests\01-wire\data\clean" ubuntu@<SERVER-IP>:~/data/
```

Aakhri command ~250 MB bhejti hai, internet ke hisaab se 5-15 minute.

### 6B. Browser se table banao (100 sites)

1. `https://teable.01wire.com` pe login karo → ek **Space** banao (naam: `01Wire`) → usme ek **Base** banao (naam: `Catalog`).
2. Left side mein **+** (Add table) → **Import** → **CSV**.
3. Laptop se ye file chuno: `C:\shreyians\side quests\01-wire\data\clean\small\test-100.csv`
4. **Import se pehle preview mein har column ka type ye set karo:**

| Type | Columns |
| --- | --- |
| Single line text | `domain` (primary), `quality_pick`, `language`, `cheaper_at`, `own_source_ref`, `location`, `site_url`, `cheapest_offer_id`, `publisher_id`, `shopify_product_id`, `synced_hash` |
| Long text | `languages_all`, `categories`, `warnings`, `special_topics_accepted`, `content_topics`, `tags`, `all_offers`, `review_flags`, `sync_error` |
| Number | `getreach_rank`, `dr`, `da`, `authority_score`, `dr_own`, `da_own`, `traffic`, `keywords`, `ref_domains`, `spam`, `offer_variants`, saare `price` wale columns |
| Single select | `source`, `status`, `link_type`, `sponsored` |
| Date | `last_synced` |

5. **Import** dabao. Table mein **100 rows** aa jaayengi. **Inhe delete mat karna**, script inke baad se shuru karega.
6. Browser ke address bar mein URL dekho: `.../table/tblXXXXXXXX/...`. **`tbl` se shuru hone wala hissa table ID hai. Note karo.**

### 6C. Teable token banao

1. Teable mein neeche-left **apni profile** → **Settings** → **Personal Access Tokens** → **Create new token**.
2. **Name:** `server-scripts`
3. **Scopes** mein tick karo: **Field read**, **Record read**, **Record create**, **Record update**.
4. **Access:** `Catalog` base chuno.
5. **Create** → token copy karo (`teable_...` se shuru). **Ye sirf ek baar dikhta hai.** Password manager mein save karo.

### 6D. Baaki sites script se daalo

Server pe (Part 4A se judo) ye chalao. Pehli command ke baad token paste karo aur Enter dabao. Screen pe kuch nahi dikhega, ye normal hai.

```bash
read -s TEABLE_TOKEN && export TEABLE_TOKEN
```

Ab `<TABLE-ID>` badal ke pehle **check** chalao (ye kuch nahi likhta, sirf jaanchta hai):

```bash
cd ~/catalog-tools
python3 teable_import.py --url http://localhost:3000 --table <TABLE-ID> --data "../data/clean/sites-part-*.csv" --check
```

Dikhna chahiye: `10 files, 189,156 rows | already in table: 100` aur `columns OK`. Phir asli import:

```bash
python3 teable_import.py --url http://localhost:3000 --table <TABLE-ID> --data "../data/clean/sites-part-*.csv"
```

Lagbhag **10-15 minute**. Aakhir mein `done | table rows: 189,156 | ... | OK` aana chahiye.

> Beech mein internet kat gaya ya window band ho gayi? Koi baat nahi. Dobara judo, `read -s` wali line chalao, aur wahi import command chala do. Script wahin se aage badhega jahan ruka tha, duplicate nahi banega.

**Note karo:** Teable token aur Table ID.

## Part 7: Shopify app banao aur uski chaabi (Client ID + Secret) nikalo

Script ko Shopify mein products banane ki permission chahiye. Iske liye Shopify mein ek chhota private app banta hai. Ye part **15 minute** ka hai. Shopify ki screens time ke saath thodi badalti rehti hain, isliye button ke naam thode alag ho sakte hain.

### 7A. Store ka asli address nikalo

1. Shopify admin kholo. Browser URL kuch aisa hoga: `admin.shopify.com/store/abc123`.
2. Aapka store address hai **`abc123.myshopify.com`**. (Ya **Settings → Domains** mein `.myshopify.com` wala address dikhega.)

### 7B. App banao

1. **Store owner** account se **dev.shopify.com** kholo (Shopify Dev Dashboard). Ya Shopify admin → **Settings → Apps** → **Develop apps** → **Build apps in Dev Dashboard**.
2. **Create app** → naam: `01Wire Catalog Sync` → Create.
3. App ke andar **Versions** / **Configuration** mein jao:
   - **Access scopes** mein `write_products` aur `read_products` daalo.
   - Baaki sab (App URL wagairah) default rehne do.
4. **Release** dabao, taaki ye settings lagu ho jaayein.
5. App ke **Overview / Home** pe **Install app** → apna store chuno → **Install**.
6. App ki **Settings** mein **Client ID** aur **Client secret** dikhenge. Dono copy karke password manager mein save karo.

> Pehle se Shopify admin mein **Develop apps** ke andar koi purana custom app hai jiske paas **Admin API access token** (`shpat_...`) hai aur `write_products` permission hai? To wo token bhi chalega. Tab Client ID/Secret ki zaroorat nahi.

### 7C. Check karo chaabi chal rahi hai

Server pe ye command chalao, teen jagah apni values daal ke:

```bash
curl -s -X POST "https://<STORE>.myshopify.com/admin/oauth/access_token" -d "grant_type=client_credentials&client_id=<CLIENT-ID>&client_secret=<CLIENT-SECRET>"
```

- Jawab mein `"access_token":"..."` aaya → **sab sahi hai**.
- Error aaya → check karo app **install** hua hai aur **release** hua hai. App aur store ek hi Shopify account/organization mein hone chahiye.

**Note karo:** `xxx.myshopify.com` address, Client ID, Client Secret.

## Part 8: Sync script lagao aur pehli baar chalao

Script Teable se sites padh ke Shopify mein products banata hai. Pehle 20 products se test, phir saare. Setup **20 minute**, aur poori pehli sync mein **kuch ghante**.

### 8A. Script ki settings file bharo

Server pe:

```bash
cd ~/catalog-tools
cp .env.example .env
chmod 600 .env
nano .env
```

Ek editor khulega. Arrow keys se chal ke har line ke `=` ke baad value likho:

| Line | Kya likhna hai |
| --- | --- |
| `TEABLE_URL` | `http://localhost:3000` (bilkul yahi) |
| `TEABLE_TABLE` | Part 6B wala Table ID (`tbl...`) |
| `TEABLE_TOKEN` | Part 6C wala token (`teable_...`) |
| `SHOPIFY_STORE` | Part 7A wala address (`abc123.myshopify.com`) |
| `SHOPIFY_ACCESS_TOKEN` | Khaali chhodo (agar `shpat_` token nahi hai) |
| `SHOPIFY_CLIENT_ID` | Part 7B wala Client ID |
| `SHOPIFY_CLIENT_SECRET` | Part 7B wala Client Secret |
| `SHOPIFY_API_VERSION` | `2026-07` hi rehne do |
| `RATE_USD` | Aaj 1 USD kitne rupaye ka hai (jaise `88`) |
| `RATE_EUR` | Aaj 1 EUR kitne rupaye ka hai (jaise `96`) |
| `MARKUP_PERCENT` | Aapka fee, % mein (jaise `30`). `0` matlab cost price pe |

Save karne ke liye **Ctrl + O**, phir **Enter**. Band karne ke liye **Ctrl + X**.

### 8B. Shopify mein filter wale fields banao (sirf ek baar)

```bash
node --env-file=.env shopify_sync.mjs --setup
```

12 lines aayengi jaise `site.dr: created`. Dobara chalaoge to `already exists` aayega, wo bhi theek hai.

### 8C. Test: pehle sirf dekho (kuch nahi bhejta)

```bash
node --env-file=.env shopify_sync.mjs --dry-run --limit 20
```

`sent: 20` aur `dry run, nothing sent` aana chahiye.

### 8D. Test: 20 products Shopify pe bhejo

```bash
node --env-file=.env shopify_sync.mjs --limit 20
```

Phir **check karo**:

- [ ] Shopify admin → **Products** mein 20 naye products hain, status **Draft**
- [ ] Ek product kholo: naam = domain, **Topic** variants (General, Crypto...) aur unki prices sahi lag rahi hain
- [ ] Teable mein pehli 20 rows ke `shopify_product_id` aur `last_synced` bhar gaye, `sync_error` khaali hai

Kuch galat dikhe to **yahin ruko** aur developer ko dikhao. Prices galat hain to `.env` mein `RATE_` / `MARKUP_` theek karo aur 8D dobara chalao, wahi 20 products update ho jaayenge.

### 8E. Saare products bhejo

Ye kaafi der chalega, isliye ise **background** mein chalao. SSH window band ho jaaye tab bhi chalta rahega:

```bash
nohup node --env-file=.env shopify_sync.mjs > ~/first-sync.log 2>&1 &
```

Progress dekhne ke liye (kabhi bhi, dobara judke bhi):

```bash
tail -f ~/first-sync.log
```

(Dekhna band karne ke liye **Ctrl + C**. Isse sync nahi rukti.) Khatam hone pe log ke aakhir mein `Shopify ok: ... | errors: ...` aayega.

### 8F. Products ko store pe dikhana

Script products **Draft** banata hai, taaki aap pehle check kar sako. Buyers ko dikhane ke liye do kaam aur hain:

1. **Active + Online Store:** products ko Active karna aur **Online Store** sales channel pe publish karna. Script abhi ye **nahi** karta. 189k products ke liye ye haath se mushkil hai, developer se script mein ye step add karwao.
2. **Filters:** Shopify admin → **Apps → Search & Discovery → Filters → Add filter** → `DR`, `Language`, `Categories`, `Link type` jaise metafields chuno, taaki buyers filter kar sakein.

## Part 9: Har 20 minute sync aur roz backup lagao

Iske baad aapko kuch chalana nahi padega. **Har 20 minute** mein sync apne aap chalega, aur har raat **1:30 baje** (Indian time) backup. Ye part **10 minute** ka hai.

Har run mein script Teable ki saari rows padhta hai (lagbhag 2-5 minute) aur sirf **nayi ya badli** sites Shopify ko bhejta hai. Kuch nahi badla to Shopify ko kuch nahi jaata. Agar pichli run abhi chal hi rahi ho (jaise rate badalne pe saare products update ho rahe hon), to nayi run apne aap skip ho jaati hai.

> ⚠️ **Ye part tabhi karo jab Part 8E wali pehli sync poori ho jaaye** (log mein `Shopify ok:` aa jaaye). Do sync ek saath chali to duplicate products ban sakte hain.

### 9A. Sync aur backup ki chhoti scripts banao

Server pe poora block ek saath paste karo:

```bash
cat > ~/sync.sh <<'EOF'
#!/bin/bash
cd ~/catalog-tools && flock -n /tmp/shopify-sync.lock node --env-file=.env shopify_sync.mjs >> ~/sync.log 2>&1
tail -n 5000 ~/sync.log > ~/sync.log.tmp && mv ~/sync.log.tmp ~/sync.log
EOF
cat > ~/backup.sh <<'EOF'
#!/bin/bash
mkdir -p ~/backups
docker compose -f ~/teable/docker-compose.yml exec -T teable-db pg_dump -U teable teable | gzip > ~/backups/teable-$(date +%F).sql.gz
find ~/backups -name '*.sql.gz' -mtime +7 -delete
EOF
chmod +x ~/sync.sh ~/backup.sh
echo "Done"
```

`flock` ka kaam: agar pichli sync abhi chal rahi ho to nayi shuru hi nahi hogi. Log file sirf aakhri 5,000 lines rakhti hai, taaki disk na bhare. Backup 7 din se purane khud mita deta hai.

### 9B. Alarm (cron) set karo

`*/20` ka matlab hai har 20 minute. Backup ka time UTC mein hai (server India se 5:30 ghante peeche chalta hai), isliye `0 20` = raat 1:30 IST:

```bash
(crontab -l 2>/dev/null; echo "0 20 * * * /home/ubuntu/backup.sh"; echo "*/20 * * * * /home/ubuntu/sync.sh") | crontab -
crontab -l
```

Do lines dikhni chahiye. Bas, set ho gaya.

### 9C. Pehli baar backup haath se chala ke dekho

```bash
~/backup.sh && ls -lh ~/backups
```

Ek `teable-2026-...sql.gz` file dikhni chahiye, size kuch MB.

### 9D. Har hafte backup laptop pe le aao

Server kharab ho jaaye to backup bhi saath jaayega. Isliye hafte mein ek baar **laptop ke PowerShell** se:

```powershell
mkdir "$env:USERPROFILE\teable-backups" -Force
scp -i "$env:USERPROFILE\.ssh\oracle.key" "ubuntu@<SERVER-IP>:~/backups/*" "$env:USERPROFILE\teable-backups\"
```

### Aage ka roz-marra kaam

| Kab | Kya karna hai |
| --- | --- |
| Teable mein site badli ya nayi site add ki | Kuch nahi. 20-25 minute mein Shopify pe aa jaayega |
| Kuch galat lage | Server pe `tail -50 ~/sync.log` dekho, aur Teable mein `sync_error` column filter karo |
| Har hafte | 9D wala backup laptop pe lao |
| Har mahine | Rupaye ka rate badla ho to `~/catalog-tools/.env` mein `RATE_USD` / `RATE_EUR` badlo. Agli run se saare products update hone lagenge (isme kuch ghante lagte hain) |
| Kabhi kabhi (Teable update) | Pehle `~/backup.sh`, phir `cd ~/teable && docker compose pull && docker compose up -d` |

## Saare creds aur tokens ek jagah

Is poore setup mein ye 13 cheezein banti hain. Sab ko ek password manager mein save karo. **Inme se koi bhi cheez chat, email, WhatsApp ya GitHub pe mat daalna.**

| # | Kya hai | Kahan se milta hai | Kahan use hota hai |
| --- | --- | --- | --- |
| 1 | Oracle login (email + password) | Part 1 mein khud banaya | cloud.oracle.com |
| 2 | Server ka Public IP | Part 2, step 8 | SSH, DNS record |
| 3 | SSH key file (`oracle.key`) | Part 2, step 5 (download) | Laptop se server pe judna |
| 4 | Domain DNS login | Aapka domain provider | Part 3B |
| 5 | Teable login (email + password) | Part 5D mein khud banaya | Teable website |
| 6 | Database password + Secret key | Part 5A ne khud banaye | Server ki `~/teable/.env` |
| 7 | Teable Table ID (`tbl...`) | Part 6B, browser URL | Script `.env` → `TEABLE_TABLE` |
| 8 | Teable token (`teable_...`) | Part 6C, Teable Settings | Script `.env` → `TEABLE_TOKEN` |
| 9 | Shopify store address (`xxx.myshopify.com`) | Part 7A | Script `.env` → `SHOPIFY_STORE` |
| 10 | Shopify Client ID | Part 7B, app Settings | Script `.env` → `SHOPIFY_CLIENT_ID` |
| 11 | Shopify Client Secret | Part 7B, app Settings | Script `.env` → `SHOPIFY_CLIENT_SECRET` |
| 12 | Rate USD / EUR | Google pe aaj ka rate | Script `.env` → `RATE_USD`, `RATE_EUR` |
| 13 | Markup % | Aapka business decision | Script `.env` → `MARKUP_PERCENT` |

### Koi token leak ho jaaye to

- **Teable token:** Teable → Settings → Personal Access Tokens → purana **Delete**, naya banao, `~/catalog-tools/.env` mein badlo.
- **Shopify secret:** Dev Dashboard → app Settings → **Rotate secret**, naya `.env` mein daalo.
- **SSH key:** Oracle → instance → nayi key add karo, purani hatao. Ye developer se karwao.

## Dikkat aaye to

Zyaatar dikkatein inme se koi ek hoti hain. Na suljhe to error ka **screenshot + jo command chalayi** developer ko bhejo (tokens chhupa ke).

| Dikkat | Kya karo |
| --- | --- |
| Oracle: "Out of capacity" | Kuch ghante / agle din dobara try karo. Pay As You Go upgrade ho gaya ho to aasaan hota hai |
| SSH: `UNPROTECTED PRIVATE KEY FILE` | Part 4A ka step 2 (`icacls` wali lines) dobara chalao |
| SSH: `Connection timed out` | IP sahi hai? Oracle mein instance **RUNNING** hai? |
| SSH: `Permission denied (publickey)` | Galat key file ya username. User hamesha `ubuntu` hai |
| `docker: permission denied` | `exit` karke dobara judo (Part 4B ka aakhri step) |
| `teable.01wire.com` nahi khul raha | (1) DNS record sahi hai? 30 min ruko. (2) Oracle Security List mein 80, 443 khule hain (Part 3A)? (3) Server firewall commands chali (Part 4B)? (4) `cd ~/teable && docker compose ps` mein teeno Up hain? |
| Taala (HTTPS) nahi aa raha | `cd ~/teable && docker compose logs caddy --tail 30` dekho. Zyaatar DNS ya port 80 band hone se hota hai |
| Teable khula par error / blank | `cd ~/teable && docker compose logs teable --tail 50` ka output developer ko bhejo |
| Import: `columns missing in the Teable table` | Part 6B mein koi column galat naam ya type se bana. Message mein naam likha hoga |
| Import: `table has more rows than the CSV files` | Galat Table ID daala hai, ya table mein extra rows hain |
| Sync: `missing ... in .env` | Us naam ki line `.env` mein khaali hai. Part 8A dekho |
| Sync: `Shopify token request failed` | Client ID / Secret galat, ya app install / release nahi hua (Part 7B, 7C) |
| Sync: `Shopify: ... ACCESS_DENIED` | App mein `write_products` scope nahi hai. Scope add karo, **Release** karo, app dobara install karo |
| Kuch products Shopify pe nahi bane | Teable mein `sync_error` column khaali nahi hai wali rows dekho, wahan wajah likhi hai. Theek karke agli sync ka intezaar karo |
| Server band ho gaya / reboot hua | Teable apne aap chalu ho jaata hai (`restart: always`). Cron bhi chalta rahega |
| Galti se kuch delete ho gaya | Developer se `~/backups` ka sabse naya backup restore karwao |
