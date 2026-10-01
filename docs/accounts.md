# Accounts

Every account the seed makes, so a test run can sign in as any shop and as the staff of both depots (spec 020,
D-94). Each signs in with its staff ID and the demo PIN the README gives (`SEED_PIN`); admin has its own
(`SEED_ADMIN_PIN`). An install seeded before these accounts gets the missing ones from the seed on its next start.
`apps/api/tests/demo-accounts.test.ts` reads this list against the seed's accounts, so the two cannot drift.

## Store managers

One for each of the 120 shops. `S-001` to `S-003` are the walkthrough's three; `S-004` to `S-120` are the other
shops in outlet order, so OUT002 is `S-004` and OUT120 is `S-120`. A store manager orders for their own shop only.

| Staff ID | Name | Role | Shop or depot |
| --- | --- | --- | --- |
| `S-001` | Nadeesha | Store manager | Fresh Nugegoda (OUT001) |
| `S-002` | Ishara | Store manager | Style Liberty Plaza (OUT017) |
| `S-003` | Tharindu | Store manager | Tech Matara (OUT064) |
| `S-004` | Chamari | Store manager | Fresh Wellawatte (OUT002) |
| `S-005` | Ayesha | Store manager | Fresh Kotahena (OUT003) |
| `S-006` | Dulani | Store manager | Fresh Borella (OUT004) |
| `S-007` | Kavitha | Store manager | Fresh Dehiwala (OUT005) |
| `S-008` | Sanduni | Store manager | Fresh Mount Lavinia (OUT006) |
| `S-009` | Mohamed | Store manager | Fresh Maradana (OUT007) |
| `S-010` | Nirmala | Store manager | Fresh Bambalapitiya (OUT008) |
| `S-011` | Rizwan | Store manager | Fresh Piliyandala (OUT009) |
| `S-012` | Thilini | Store manager | Fresh Kollupitiya (OUT010) |
| `S-013` | Sivakumar | Store manager | Fresh Moratuwa (OUT011) |
| `S-014` | Hiruni | Store manager | Fresh Battaramulla (OUT012) |
| `S-015` | Ajith | Store manager | Fresh Rajagiriya (OUT013) |
| `S-016` | Fathima | Store manager | Fresh Pettah (OUT014) |
| `S-017` | Kumudini | Store manager | Style Majestic City (OUT015) |
| `S-018` | Anoma | Store manager | Style Crescat Boulevard (OUT016) |
| `S-019` | Rajan | Store manager | Style One Galle Face (OUT018) |
| `S-020` | Iresha | Store manager | Style Maharagama (OUT019) |
| `S-021` | Lakmini | Store manager | Style Kottawa (OUT020) |
| `S-022` | Imran | Store manager | Tech Unity Plaza (OUT021) |
| `S-023` | Sachini | Store manager | Tech Colombo City Centre (OUT022) |
| `S-024` | Tharshini | Store manager | Tech Kollupitiya (OUT023) |
| `S-025` | Madhavi | Store manager | Tech Bambalapitiya (OUT024) |
| `S-026` | Bandula | Store manager | Fresh Negombo (OUT025) |
| `S-027` | Nilmini | Store manager | Fresh Gampaha (OUT026) |
| `S-028` | Zainab | Store manager | Fresh Ja-Ela (OUT027) |
| `S-029` | Shashika | Store manager | Fresh Kandana (OUT028) |
| `S-030` | Gayani | Store manager | Fresh Kelaniya (OUT029) |
| `S-031` | Murugan | Store manager | Fresh Ragama (OUT030) |
| `S-032` | Yasoda | Store manager | Fresh Minuwangoda (OUT031) |
| `S-033` | Ruwani | Store manager | Fresh Katunayake (OUT032) |
| `S-034` | Chandana | Store manager | Fresh Veyangoda (OUT033) |
| `S-035` | Sewwandi | Store manager | Fresh Mirigama (OUT034) |
| `S-036` | Farhan | Store manager | Style Kiribathgoda (OUT035) |
| `S-037` | Malsha | Store manager | Style Wattala (OUT036) |
| `S-038` | Priya | Store manager | Style Kadawatha (OUT037) |
| `S-039` | Piumi | Store manager | Tech Yakkala (OUT038) |
| `S-040` | Damith | Store manager | Tech Nittambuwa (OUT039) |
| `S-041` | Hasini | Store manager | Fresh Wadduwa (OUT040) |
| `S-042` | Kaushalya | Store manager | Fresh Panadura (OUT041) |
| `S-043` | Selvam | Store manager | Fresh Kalutara (OUT042) |
| `S-044` | Inoka | Store manager | Fresh Beruwala (OUT043) |
| `S-045` | Dinusha | Store manager | Fresh Aluthgama (OUT044) |
| `S-046` | Nazeer | Store manager | Fresh Matugama (OUT045) |
| `S-047` | Upeksha | Store manager | Fresh Bandaragama (OUT046) |
| `S-048` | Nethmi | Store manager | Style Panadura (OUT047) |
| `S-049` | Gihan | Store manager | Style Kalutara (OUT048) |
| `S-050` | Oshadi | Store manager | Tech Horana (OUT049) |
| `S-051` | Lakshmi | Store manager | Fresh Hikkaduwa (OUT050) |
| `S-052` | Sajini | Store manager | Fresh Galle Fort (OUT051) |
| `S-053` | Tharushi | Store manager | Fresh Ahangama (OUT052) |
| `S-054` | Hemantha | Store manager | Fresh Karapitiya (OUT053) |
| `S-055` | Erandi | Store manager | Fresh Unawatuna (OUT054) |
| `S-056` | Shafna | Store manager | Fresh Koggala (OUT055) |
| `S-057` | Hansika | Store manager | Style Galle Dutch Hospital (OUT056) |
| `S-058` | Imesha | Store manager | Style Ambalangoda (OUT057) |
| `S-059` | Kannan | Store manager | Tech Galle (OUT058) |
| `S-060` | Janani | Store manager | Fresh Akuressa (OUT059) |
| `S-061` | Kalpani | Store manager | Fresh Dickwella (OUT060) |
| `S-062` | Indika | Store manager | Fresh Hakmana (OUT061) |
| `S-063` | Lasanthi | Store manager | Fresh Kamburupitiya (OUT062) |
| `S-064` | Menaka | Store manager | Style Weligama (OUT063) |
| `S-065` | Rifkhan | Store manager | Fresh Polgahawela (OUT065) |
| `S-066` | Nayomi | Store manager | Fresh Pannala (OUT066) |
| `S-067` | Pavithra | Store manager | Fresh Alawwa (OUT067) |
| `S-068` | Senthil | Store manager | Fresh Wariyapola (OUT068) |
| `S-069` | Rashmi | Store manager | Fresh Mawathagama (OUT069) |
| `S-070` | Jayantha | Store manager | Style Kuliyapitiya (OUT070) |
| `S-071` | Samanthi | Store manager | Style Narammala (OUT071) |
| `S-072` | Thushari | Store manager | Tech Kurunegala (OUT072) |
| `S-073` | Hafsa | Store manager | Fresh Wennappuwa (OUT073) |
| `S-074` | Udari | Store manager | Fresh Chilaw (OUT074) |
| `S-075` | Vindya | Store manager | Fresh Puttalam (OUT075) |
| `S-076` | Arun | Store manager | Fresh Katukele (OUT076) |
| `S-077` | Wathsala | Store manager | Fresh Mahaiyawa (OUT077) |
| `S-078` | Kapila | Store manager | Fresh Asgiriya (OUT078) |
| `S-079` | Yashodha | Store manager | Fresh Ampitiya (OUT079) |
| `S-080` | Buddhini | Store manager | Fresh Lewella (OUT080) |
| `S-081` | Ashraff | Store manager | Fresh Tennekumbura (OUT081) |
| `S-082` | Champika | Store manager | Fresh Watapuluwa (OUT082) |
| `S-083` | Dilrukshi | Store manager | Fresh Mulgampola (OUT083) |
| `S-084` | Ganesh | Store manager | Fresh Nawalapitiya (OUT084) |
| `S-085` | Gimhani | Store manager | Fresh Peradeniya (OUT085) |
| `S-086` | Lalith | Store manager | Fresh Katugastota (OUT086) |
| `S-087` | Harshani | Store manager | Fresh Gampola (OUT087) |
| `S-088` | Ishani | Store manager | Style Akurana (OUT088) |
| `S-089` | Shiyam | Store manager | Style Kandy City Centre (OUT089) |
| `S-090` | Jayani | Store manager | Style Royal Mall (OUT090) |
| `S-091` | Kanchana | Store manager | Style Pilimathalawa (OUT091) |
| `S-092` | Vasanthi | Store manager | Style Kundasale (OUT092) |
| `S-093` | Lochana | Store manager | Tech Kadugannawa (OUT093) |
| `S-094` | Malinda | Store manager | Tech Kandy City Centre (OUT094) |
| `S-095` | Manjula | Store manager | Tech Digana (OUT095) |
| `S-096` | Niluka | Store manager | Fresh Ukuwela (OUT096) |
| `S-097` | Fazil | Store manager | Fresh Rattota (OUT097) |
| `S-098` | Prabha | Store manager | Fresh Dambulla (OUT098) |
| `S-099` | Rasika | Store manager | Fresh Sigiriya (OUT099) |
| `S-100` | Meena | Store manager | Fresh Galewela (OUT100) |
| `S-101` | Sandamali | Store manager | Fresh Naula (OUT101) |
| `S-102` | Nalaka | Store manager | Style Aluvihare (OUT102) |
| `S-103` | Shanika | Store manager | Tech Matale (OUT103) |
| `S-104` | Uthpala | Store manager | Fresh Talawakele (OUT104) |
| `S-105` | Nuzrath | Store manager | Fresh Hatton (OUT105) |
| `S-106` | Anjali | Store manager | Fresh Kotagala (OUT106) |
| `S-107` | Prabath | Store manager | Fresh Nanu Oya (OUT107) |
| `S-108` | Dilani | Store manager | Fresh Nuwara Eliya (OUT108) |
| `S-109` | Vijay | Store manager | Style Ragala (OUT109) |
| `S-110` | Rohan | Store manager | Fresh Welimada (OUT110) |
| `S-111` | Michelle | Store manager | Fresh Bandarawela (OUT111) |
| `S-112` | Sajith | Store manager | Fresh Haputale (OUT112) |
| `S-113` | Ramesh | Store manager | Fresh Hali-Ela (OUT113) |
| `S-114` | Kumari | Store manager | Style Ella (OUT114) |
| `S-115` | Tharanga | Store manager | Tech Badulla (OUT115) |
| `S-116` | Selvi | Store manager | Fresh Warakapola (OUT116) |
| `S-117` | Upul | Store manager | Fresh Rambukkana (OUT117) |
| `S-118` | Shirani | Store manager | Fresh Mawanella (OUT118) |
| `S-119` | Kumaran | Store manager | Fresh Ruwanwella (OUT119) |
| `S-120` | Vimukthi | Store manager | Style Kegalle (OUT120) |

## Peliyagoda depot

The dispatcher, the loader and a driver for each of the 35 vehicles that are not in the workshop on Thursday.
Ruwan, the dispatcher, can switch to Kandy and back.

| Staff ID | Name | Role | Shop or depot |
| --- | --- | --- | --- |
| `P-001` | Ruwan | Dispatcher | Peliyagoda depot |
| `L-001` | Kasun | Loader | Peliyagoda depot |
| `D-001` | Dilshan | Driver | Peliyagoda depot |
| `D-003` | Chaminda | Driver | Peliyagoda depot |
| `D-004` | Lasantha | Driver | Peliyagoda depot |
| `D-005` | Priyantha | Driver | Peliyagoda depot |
| `D-006` | Sanjeewa | Driver | Peliyagoda depot |
| `D-007` | Mahesh | Driver | Peliyagoda depot |
| `D-008` | Nuwan | Driver | Peliyagoda depot |
| `D-009` | Saman | Driver | Peliyagoda depot |
| `D-010` | Pradeep | Driver | Peliyagoda depot |
| `D-011` | Asanka | Driver | Peliyagoda depot |
| `D-012` | Chathura | Driver | Peliyagoda depot |
| `D-013` | Kamal | Driver | Peliyagoda depot |
| `D-014` | Sunil | Driver | Peliyagoda depot |
| `D-015` | Nimal | Driver | Peliyagoda depot |
| `D-016` | Janaka | Driver | Peliyagoda depot |
| `D-017` | Roshan | Driver | Peliyagoda depot |
| `D-018` | Suresh | Driver | Peliyagoda depot |
| `D-019` | Anura | Driver | Peliyagoda depot |
| `D-020` | Buddhika | Driver | Peliyagoda depot |
| `D-021` | Dinesh | Driver | Peliyagoda depot |
| `D-022` | Gayan | Driver | Peliyagoda depot |
| `D-023` | Harsha | Driver | Peliyagoda depot |
| `D-024` | Isuru | Driver | Peliyagoda depot |
| `D-025` | Jagath | Driver | Peliyagoda depot |
| `D-026` | Kelum | Driver | Peliyagoda depot |
| `D-027` | Lahiru | Driver | Peliyagoda depot |
| `D-028` | Madushan | Driver | Peliyagoda depot |
| `D-029` | Nalin | Driver | Peliyagoda depot |
| `D-030` | Pasan | Driver | Peliyagoda depot |
| `D-031` | Rangana | Driver | Peliyagoda depot |
| `D-032` | Sampath | Driver | Peliyagoda depot |
| `D-033` | Thilak | Driver | Peliyagoda depot |
| `D-034` | Udara | Driver | Peliyagoda depot |
| `D-035` | Viraj | Driver | Peliyagoda depot |
| `D-036` | Wasantha | Driver | Peliyagoda depot |

## Kandy depot

A loader and a driver for each of Kandy's 22 vehicles, none of which is in the workshop on Thursday. Kandy has no
dispatcher of its own: Ruwan plans it after switching to it.

| Staff ID | Name | Role | Shop or depot |
| --- | --- | --- | --- |
| `L-002` | Sarath | Loader | Kandy depot |
| `D-002` | Prasanna | Driver | Kandy depot |
| `D-037` | Ashen | Driver | Kandy depot |
| `D-038` | Charith | Driver | Kandy depot |
| `D-039` | Dulaj | Driver | Kandy depot |
| `D-040` | Hasitha | Driver | Kandy depot |
| `D-041` | Kavindu | Driver | Kandy depot |
| `D-042` | Lakshan | Driver | Kandy depot |
| `D-043` | Mihiran | Driver | Kandy depot |
| `D-044` | Nadun | Driver | Kandy depot |
| `D-045` | Pathum | Driver | Kandy depot |
| `D-046` | Ravindu | Driver | Kandy depot |
| `D-047` | Sahan | Driver | Kandy depot |
| `D-048` | Thisara | Driver | Kandy depot |
| `D-049` | Eranga | Driver | Kandy depot |
| `D-050` | Niroshan | Driver | Kandy depot |
| `D-051` | Sandun | Driver | Kandy depot |
| `D-052` | Supun | Driver | Kandy depot |
| `D-053` | Thushara | Driver | Kandy depot |
| `D-054` | Asitha | Driver | Kandy depot |
| `D-055` | Rajkumar | Driver | Kandy depot |
| `D-056` | Nawaz | Driver | Kandy depot |
| `D-057` | Chamal | Driver | Kandy depot |

## Admin

The admin signs in with a PIN of its own, not the demo PIN.

| Staff ID | Name | Role | Shop or depot |
| --- | --- | --- | --- |
| `A-001` | Admin | Admin | Everything |
