# Seeded demo accounts

Sign in with a **Staff ID** and the **four-digit PIN** below. The PIN is the password for these demo accounts.
Open [Wayfinder locally](http://localhost:3000) after starting Docker, or use the submitted demo URL.

## Start here

These four accounts follow the [judge walkthrough](walkthrough.md). Use separate browser profiles for each
role; tabs in the same profile share a login. The driver gets work after the dispatcher sends the plan.

| Role | Staff ID | PIN / password | Person | Assignment |
| --- | --- | --- | --- | --- |
| Dispatcher | `P-001` | `1234` | Ruwan | Peliyagoda; can switch to Kandy |
| Loader | `L-001` | `1234` | Kasun | Peliyagoda; load the dispatched trip |
| Driver | `D-036` | `1234` | Wasantha | Usual driver of reefer van VEH035 |
| Store manager | `S-001` | `1234` | Nadeesha | Fresh Nugegoda (OUT001) |

These are the public seed defaults: **1234** for all operational accounts and **9024** for admin.
A fresh install can override them with `SEED_PIN` and `SEED_ADMIN_PIN`. Existing accounts keep their PINs
when the seed runs again, so a customised or hosted install may use different PINs.

## All accounts

The full list below covers all 181 seeded accounts. Each store manager can access their own shop only.
The account test checks this list against the seed.

## Store managers

One for each of the 120 shops. `S-001` to `S-003` are the walkthrough's three; `S-004` to `S-120` are the other
shops in outlet order, so OUT002 is `S-004` and OUT120 is `S-120`. A store manager orders for their own shop only.

| Staff ID | Name | Role | Shop or depot | PIN / password |
| --- | --- | --- | --- | --- |
| `S-001` | Nadeesha | Store manager | Fresh Nugegoda (OUT001) | `1234` |
| `S-002` | Ishara | Store manager | Style Liberty Plaza (OUT017) | `1234` |
| `S-003` | Tharindu | Store manager | Tech Matara (OUT064) | `1234` |
| `S-004` | Chamari | Store manager | Fresh Wellawatte (OUT002) | `1234` |
| `S-005` | Ayesha | Store manager | Fresh Kotahena (OUT003) | `1234` |
| `S-006` | Dulani | Store manager | Fresh Borella (OUT004) | `1234` |
| `S-007` | Kavitha | Store manager | Fresh Dehiwala (OUT005) | `1234` |
| `S-008` | Sanduni | Store manager | Fresh Mount Lavinia (OUT006) | `1234` |
| `S-009` | Mohamed | Store manager | Fresh Maradana (OUT007) | `1234` |
| `S-010` | Nirmala | Store manager | Fresh Bambalapitiya (OUT008) | `1234` |
| `S-011` | Rizwan | Store manager | Fresh Piliyandala (OUT009) | `1234` |
| `S-012` | Thilini | Store manager | Fresh Kollupitiya (OUT010) | `1234` |
| `S-013` | Sivakumar | Store manager | Fresh Moratuwa (OUT011) | `1234` |
| `S-014` | Hiruni | Store manager | Fresh Battaramulla (OUT012) | `1234` |
| `S-015` | Ajith | Store manager | Fresh Rajagiriya (OUT013) | `1234` |
| `S-016` | Fathima | Store manager | Fresh Pettah (OUT014) | `1234` |
| `S-017` | Kumudini | Store manager | Style Majestic City (OUT015) | `1234` |
| `S-018` | Anoma | Store manager | Style Crescat Boulevard (OUT016) | `1234` |
| `S-019` | Rajan | Store manager | Style One Galle Face (OUT018) | `1234` |
| `S-020` | Iresha | Store manager | Style Maharagama (OUT019) | `1234` |
| `S-021` | Lakmini | Store manager | Style Kottawa (OUT020) | `1234` |
| `S-022` | Imran | Store manager | Tech Unity Plaza (OUT021) | `1234` |
| `S-023` | Sachini | Store manager | Tech Colombo City Centre (OUT022) | `1234` |
| `S-024` | Tharshini | Store manager | Tech Kollupitiya (OUT023) | `1234` |
| `S-025` | Madhavi | Store manager | Tech Bambalapitiya (OUT024) | `1234` |
| `S-026` | Bandula | Store manager | Fresh Negombo (OUT025) | `1234` |
| `S-027` | Nilmini | Store manager | Fresh Gampaha (OUT026) | `1234` |
| `S-028` | Zainab | Store manager | Fresh Ja-Ela (OUT027) | `1234` |
| `S-029` | Shashika | Store manager | Fresh Kandana (OUT028) | `1234` |
| `S-030` | Gayani | Store manager | Fresh Kelaniya (OUT029) | `1234` |
| `S-031` | Murugan | Store manager | Fresh Ragama (OUT030) | `1234` |
| `S-032` | Yasoda | Store manager | Fresh Minuwangoda (OUT031) | `1234` |
| `S-033` | Ruwani | Store manager | Fresh Katunayake (OUT032) | `1234` |
| `S-034` | Chandana | Store manager | Fresh Veyangoda (OUT033) | `1234` |
| `S-035` | Sewwandi | Store manager | Fresh Mirigama (OUT034) | `1234` |
| `S-036` | Farhan | Store manager | Style Kiribathgoda (OUT035) | `1234` |
| `S-037` | Malsha | Store manager | Style Wattala (OUT036) | `1234` |
| `S-038` | Priya | Store manager | Style Kadawatha (OUT037) | `1234` |
| `S-039` | Piumi | Store manager | Tech Yakkala (OUT038) | `1234` |
| `S-040` | Damith | Store manager | Tech Nittambuwa (OUT039) | `1234` |
| `S-041` | Hasini | Store manager | Fresh Wadduwa (OUT040) | `1234` |
| `S-042` | Kaushalya | Store manager | Fresh Panadura (OUT041) | `1234` |
| `S-043` | Selvam | Store manager | Fresh Kalutara (OUT042) | `1234` |
| `S-044` | Inoka | Store manager | Fresh Beruwala (OUT043) | `1234` |
| `S-045` | Dinusha | Store manager | Fresh Aluthgama (OUT044) | `1234` |
| `S-046` | Nazeer | Store manager | Fresh Matugama (OUT045) | `1234` |
| `S-047` | Upeksha | Store manager | Fresh Bandaragama (OUT046) | `1234` |
| `S-048` | Nethmi | Store manager | Style Panadura (OUT047) | `1234` |
| `S-049` | Gihan | Store manager | Style Kalutara (OUT048) | `1234` |
| `S-050` | Oshadi | Store manager | Tech Horana (OUT049) | `1234` |
| `S-051` | Lakshmi | Store manager | Fresh Hikkaduwa (OUT050) | `1234` |
| `S-052` | Sajini | Store manager | Fresh Galle Fort (OUT051) | `1234` |
| `S-053` | Tharushi | Store manager | Fresh Ahangama (OUT052) | `1234` |
| `S-054` | Hemantha | Store manager | Fresh Karapitiya (OUT053) | `1234` |
| `S-055` | Erandi | Store manager | Fresh Unawatuna (OUT054) | `1234` |
| `S-056` | Shafna | Store manager | Fresh Koggala (OUT055) | `1234` |
| `S-057` | Hansika | Store manager | Style Galle Dutch Hospital (OUT056) | `1234` |
| `S-058` | Imesha | Store manager | Style Ambalangoda (OUT057) | `1234` |
| `S-059` | Kannan | Store manager | Tech Galle (OUT058) | `1234` |
| `S-060` | Janani | Store manager | Fresh Akuressa (OUT059) | `1234` |
| `S-061` | Kalpani | Store manager | Fresh Dickwella (OUT060) | `1234` |
| `S-062` | Indika | Store manager | Fresh Hakmana (OUT061) | `1234` |
| `S-063` | Lasanthi | Store manager | Fresh Kamburupitiya (OUT062) | `1234` |
| `S-064` | Menaka | Store manager | Style Weligama (OUT063) | `1234` |
| `S-065` | Rifkhan | Store manager | Fresh Polgahawela (OUT065) | `1234` |
| `S-066` | Nayomi | Store manager | Fresh Pannala (OUT066) | `1234` |
| `S-067` | Pavithra | Store manager | Fresh Alawwa (OUT067) | `1234` |
| `S-068` | Senthil | Store manager | Fresh Wariyapola (OUT068) | `1234` |
| `S-069` | Rashmi | Store manager | Fresh Mawathagama (OUT069) | `1234` |
| `S-070` | Jayantha | Store manager | Style Kuliyapitiya (OUT070) | `1234` |
| `S-071` | Samanthi | Store manager | Style Narammala (OUT071) | `1234` |
| `S-072` | Thushari | Store manager | Tech Kurunegala (OUT072) | `1234` |
| `S-073` | Hafsa | Store manager | Fresh Wennappuwa (OUT073) | `1234` |
| `S-074` | Udari | Store manager | Fresh Chilaw (OUT074) | `1234` |
| `S-075` | Vindya | Store manager | Fresh Puttalam (OUT075) | `1234` |
| `S-076` | Arun | Store manager | Fresh Katukele (OUT076) | `1234` |
| `S-077` | Wathsala | Store manager | Fresh Mahaiyawa (OUT077) | `1234` |
| `S-078` | Kapila | Store manager | Fresh Asgiriya (OUT078) | `1234` |
| `S-079` | Yashodha | Store manager | Fresh Ampitiya (OUT079) | `1234` |
| `S-080` | Buddhini | Store manager | Fresh Lewella (OUT080) | `1234` |
| `S-081` | Ashraff | Store manager | Fresh Tennekumbura (OUT081) | `1234` |
| `S-082` | Champika | Store manager | Fresh Watapuluwa (OUT082) | `1234` |
| `S-083` | Dilrukshi | Store manager | Fresh Mulgampola (OUT083) | `1234` |
| `S-084` | Ganesh | Store manager | Fresh Nawalapitiya (OUT084) | `1234` |
| `S-085` | Gimhani | Store manager | Fresh Peradeniya (OUT085) | `1234` |
| `S-086` | Lalith | Store manager | Fresh Katugastota (OUT086) | `1234` |
| `S-087` | Harshani | Store manager | Fresh Gampola (OUT087) | `1234` |
| `S-088` | Ishani | Store manager | Style Akurana (OUT088) | `1234` |
| `S-089` | Shiyam | Store manager | Style Kandy City Centre (OUT089) | `1234` |
| `S-090` | Jayani | Store manager | Style Royal Mall (OUT090) | `1234` |
| `S-091` | Kanchana | Store manager | Style Pilimathalawa (OUT091) | `1234` |
| `S-092` | Vasanthi | Store manager | Style Kundasale (OUT092) | `1234` |
| `S-093` | Lochana | Store manager | Tech Kadugannawa (OUT093) | `1234` |
| `S-094` | Malinda | Store manager | Tech Kandy City Centre (OUT094) | `1234` |
| `S-095` | Manjula | Store manager | Tech Digana (OUT095) | `1234` |
| `S-096` | Niluka | Store manager | Fresh Ukuwela (OUT096) | `1234` |
| `S-097` | Fazil | Store manager | Fresh Rattota (OUT097) | `1234` |
| `S-098` | Prabha | Store manager | Fresh Dambulla (OUT098) | `1234` |
| `S-099` | Rasika | Store manager | Fresh Sigiriya (OUT099) | `1234` |
| `S-100` | Meena | Store manager | Fresh Galewela (OUT100) | `1234` |
| `S-101` | Sandamali | Store manager | Fresh Naula (OUT101) | `1234` |
| `S-102` | Nalaka | Store manager | Style Aluvihare (OUT102) | `1234` |
| `S-103` | Shanika | Store manager | Tech Matale (OUT103) | `1234` |
| `S-104` | Uthpala | Store manager | Fresh Talawakele (OUT104) | `1234` |
| `S-105` | Nuzrath | Store manager | Fresh Hatton (OUT105) | `1234` |
| `S-106` | Anjali | Store manager | Fresh Kotagala (OUT106) | `1234` |
| `S-107` | Prabath | Store manager | Fresh Nanu Oya (OUT107) | `1234` |
| `S-108` | Dilani | Store manager | Fresh Nuwara Eliya (OUT108) | `1234` |
| `S-109` | Vijay | Store manager | Style Ragala (OUT109) | `1234` |
| `S-110` | Rohan | Store manager | Fresh Welimada (OUT110) | `1234` |
| `S-111` | Michelle | Store manager | Fresh Bandarawela (OUT111) | `1234` |
| `S-112` | Sajith | Store manager | Fresh Haputale (OUT112) | `1234` |
| `S-113` | Ramesh | Store manager | Fresh Hali-Ela (OUT113) | `1234` |
| `S-114` | Kumari | Store manager | Style Ella (OUT114) | `1234` |
| `S-115` | Tharanga | Store manager | Tech Badulla (OUT115) | `1234` |
| `S-116` | Selvi | Store manager | Fresh Warakapola (OUT116) | `1234` |
| `S-117` | Upul | Store manager | Fresh Rambukkana (OUT117) | `1234` |
| `S-118` | Shirani | Store manager | Fresh Mawanella (OUT118) | `1234` |
| `S-119` | Kumaran | Store manager | Fresh Ruwanwella (OUT119) | `1234` |
| `S-120` | Vimukthi | Store manager | Style Kegalle (OUT120) | `1234` |

## Peliyagoda depot

The dispatcher, the loader and a driver for each of the 35 vehicles that are not in the workshop on Thursday.
Ruwan, the dispatcher, can switch to Kandy and back. Each truck's usual driver pairs the drivers in staff ID order with
the trucks in id order (spec 026), so `D-036` Wasantha drives VEH035, the fridge van, and is the walkthrough's driver.

| Staff ID | Name | Role | Shop or depot | PIN / password |
| --- | --- | --- | --- | --- |
| `P-001` | Ruwan | Dispatcher | Peliyagoda depot | `1234` |
| `L-001` | Kasun | Loader | Peliyagoda depot | `1234` |
| `D-001` | Dilshan | Driver | Peliyagoda depot | `1234` |
| `D-003` | Chaminda | Driver | Peliyagoda depot | `1234` |
| `D-004` | Lasantha | Driver | Peliyagoda depot | `1234` |
| `D-005` | Priyantha | Driver | Peliyagoda depot | `1234` |
| `D-006` | Sanjeewa | Driver | Peliyagoda depot | `1234` |
| `D-007` | Mahesh | Driver | Peliyagoda depot | `1234` |
| `D-008` | Nuwan | Driver | Peliyagoda depot | `1234` |
| `D-009` | Saman | Driver | Peliyagoda depot | `1234` |
| `D-010` | Pradeep | Driver | Peliyagoda depot | `1234` |
| `D-011` | Asanka | Driver | Peliyagoda depot | `1234` |
| `D-012` | Chathura | Driver | Peliyagoda depot | `1234` |
| `D-013` | Kamal | Driver | Peliyagoda depot | `1234` |
| `D-014` | Sunil | Driver | Peliyagoda depot | `1234` |
| `D-015` | Nimal | Driver | Peliyagoda depot | `1234` |
| `D-016` | Janaka | Driver | Peliyagoda depot | `1234` |
| `D-017` | Roshan | Driver | Peliyagoda depot | `1234` |
| `D-018` | Suresh | Driver | Peliyagoda depot | `1234` |
| `D-019` | Anura | Driver | Peliyagoda depot | `1234` |
| `D-020` | Buddhika | Driver | Peliyagoda depot | `1234` |
| `D-021` | Dinesh | Driver | Peliyagoda depot | `1234` |
| `D-022` | Gayan | Driver | Peliyagoda depot | `1234` |
| `D-023` | Harsha | Driver | Peliyagoda depot | `1234` |
| `D-024` | Isuru | Driver | Peliyagoda depot | `1234` |
| `D-025` | Jagath | Driver | Peliyagoda depot | `1234` |
| `D-026` | Kelum | Driver | Peliyagoda depot | `1234` |
| `D-027` | Lahiru | Driver | Peliyagoda depot | `1234` |
| `D-028` | Madushan | Driver | Peliyagoda depot | `1234` |
| `D-029` | Nalin | Driver | Peliyagoda depot | `1234` |
| `D-030` | Pasan | Driver | Peliyagoda depot | `1234` |
| `D-031` | Rangana | Driver | Peliyagoda depot | `1234` |
| `D-032` | Sampath | Driver | Peliyagoda depot | `1234` |
| `D-033` | Thilak | Driver | Peliyagoda depot | `1234` |
| `D-034` | Udara | Driver | Peliyagoda depot | `1234` |
| `D-035` | Viraj | Driver | Peliyagoda depot | `1234` |
| `D-036` | Wasantha | Driver | Peliyagoda depot | `1234` |

## Kandy depot

A loader and a driver for each of Kandy's 22 vehicles, none of which is in the workshop on Thursday. Kandy has no
dispatcher of its own: Ruwan plans it after switching to it.

| Staff ID | Name | Role | Shop or depot | PIN / password |
| --- | --- | --- | --- | --- |
| `L-002` | Sarath | Loader | Kandy depot | `1234` |
| `D-002` | Prasanna | Driver | Kandy depot | `1234` |
| `D-037` | Ashen | Driver | Kandy depot | `1234` |
| `D-038` | Charith | Driver | Kandy depot | `1234` |
| `D-039` | Dulaj | Driver | Kandy depot | `1234` |
| `D-040` | Hasitha | Driver | Kandy depot | `1234` |
| `D-041` | Kavindu | Driver | Kandy depot | `1234` |
| `D-042` | Lakshan | Driver | Kandy depot | `1234` |
| `D-043` | Mihiran | Driver | Kandy depot | `1234` |
| `D-044` | Nadun | Driver | Kandy depot | `1234` |
| `D-045` | Pathum | Driver | Kandy depot | `1234` |
| `D-046` | Ravindu | Driver | Kandy depot | `1234` |
| `D-047` | Sahan | Driver | Kandy depot | `1234` |
| `D-048` | Thisara | Driver | Kandy depot | `1234` |
| `D-049` | Eranga | Driver | Kandy depot | `1234` |
| `D-050` | Niroshan | Driver | Kandy depot | `1234` |
| `D-051` | Sandun | Driver | Kandy depot | `1234` |
| `D-052` | Supun | Driver | Kandy depot | `1234` |
| `D-053` | Thushara | Driver | Kandy depot | `1234` |
| `D-054` | Asitha | Driver | Kandy depot | `1234` |
| `D-055` | Rajkumar | Driver | Kandy depot | `1234` |
| `D-056` | Nawaz | Driver | Kandy depot | `1234` |
| `D-057` | Chamal | Driver | Kandy depot | `1234` |

## Admin

The admin signs in with a PIN of its own, not the demo PIN.

| Staff ID | Name | Role | Shop or depot | PIN / password |
| --- | --- | --- | --- | --- |
| `A-001` | Admin | Admin | Everything | `9024` |
