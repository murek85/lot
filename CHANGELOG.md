# Dziennik zmian – Lot nad Polską

Historia do 0.7 odtworzona z przebiegu prac nad prototypem (sprzed pierwszego commitu). Numery 0.1–0.6 nadane
wstecz kolejnym etapom; od 0.7 numer jest pokazywany w grze. Kolejność wewnątrz wersji – od najważniejszych zmian.

## W przygotowaniu – własne kafle dla kolejnych województw

- **Poprawka: świecące linie nocą w górach i lasach** (`src/world/lights.js`): plamy światła latarni pochodzą
  z tekstury w oknie ~2,8 km wokół kamery, adresowanej w kółko. Dalej niż ~1,4 km od kamery odczyt trafiał w plamy
  zupełnie innego miejsca, przez co powtórzony wzór ulic wsi świecił na zboczach, koronach drzew i skałach. Poza
  oknem światła latarni na ziemi już nie ma (lampy z daleka widać jak dotąd).
- **Mokre nawierzchnie w deszczu** (`src/gfx/wet.js`, drogi, dachy, teren): zmoczenie narasta w deszczu (~20 s)
  i schnie po nim (~2 min). Mokry asfalt i dachy ciemnieją i odbijają niebo (pod pełnym zachmurzeniem szare)
  z Fresnelem, odblask słońca w prześwitach, nocą rozlane światło latarni. Kałuże w koleinach dróg gruntowych
  i na płaskich dachach przy ulewie, mokra gleba lekko ciemniejsza.
- **Elektrownie wiatrowe i punkty orientacyjne** (nowa warstwa `landmarks` w `tools/tiles/lot-schema.yml`,
  `landmarkInfo` w `src/gen/osmtags.js`, geometria w `src/gen/landmarkgeo.js`, `src/landmarks.js`): wiatraki z OSM
  (wieża, gondola, wirnik o średnicy z danych) ustawiają się pod wiatr i obracają (~14 obr./min, przy ciszy stoją).
  Kominy-punkty (od 20 m, wysokie w czerwono-białe pasy), wieże szybowe (kratownica z kołami linowymi i zastrzałem),
  wieże ciśnień, maszty telekomunikacyjne w czerwono-białe odcinki. Światła przeszkodowe w otwartym świecie: jeden
  wspólny zestaw dla wszystkich kafli, z kominami i chłodniami z obrysów budynków (wcześniej liczone, ale nie
  rysowane). Kafle wektorowe Śląskiego, Małopolskiego i Opolskiego przepieczone.
- **Poprawka wypiekania kafli** (`tools/bake-tiles.js`, `tools/pack-tiles.js`): `tiles.json` zapisywany dopiero po
  spakowaniu archiwów. Wcześniej gra uruchomiona w trakcie pakowania zapisywała w pamięci kafli starą treść pod nowym
  znacznikiem wypieczenia i trzymała ją aż do kolejnego wypieczenia.
- **Zima na dachach i drogach** (`src/buildings.js`, `src/roads.js`): śnieg na dachach (na stromych mniej, w plamach).
  Drogi główne odśnieżone i mokre od soli, ze śniegiem przy krawędziach; lokalne z ubitym śniegiem i ciemniejszymi
  koleinami; gruntowe białe.
- **Poprawka: potoki na zboczach** (`riverArrays` w `src/objgeo.js`): gdy linia cieku z OSM biegnie po zboczu obok doliny
  w modelu terenu, pozioma wstęga wody wisiała nad niższym stokiem (do ~1,5 m) i chowała się pod wyższym. Wąskie cieki
  (poniżej 12 m) leżą teraz na terenie po obu brzegach, a szerokie rzeki mają brzeg opuszczony do niższego terenu.
- **Poprawka: gęstość siatki terenu przy kamerze swobodnej** (`src/world/chunkview.js`): rzadsza siatka dalekich kafli
  liczona jest od bliższego z dwóch punktów: samolotu albo kamery. Wcześniej teren pod odlatującą kamerą tracił
  szczegóły i rozjeżdżał się z wodą i drogami.
- **Poprawka: strefy kierunku pól** (`src/terrain.js`): strefy są komórkami Woronoja, więc ich granice to proste odcinki
  z miedzą. Wcześniej poziomice szumu potrafiły zamknąć się w okrąg o promieniu kilkuset metrów, który przecinał pola
  łukiem.
- **Daleki las** (`src/terrain.js`, poza zasięgiem dalekich drzew – 5 km): mozaika wydzieleń jak na zdjęciach lotniczych –
  wyraźniejsze różnice barwy między wydzieleniami, cień wyższego drzewostanu na młodniku i zrębie wzdłuż granicy od
  strony słońca, kępy i luki w skali 50–160 m (z domieszką liściastych – cieplejszy odcień). Jaśniejszy (`farForest`
  0,5 → 0,75) – bez ciemnego pasa za granicą dalekich drzew. Koszt pomijalny (całość klatki ~5,4 ms GPU).
- **Rzeki z nurtem** (`src/rivers.js`, `riverArrays` w `src/objgeo.js`): zmarszczki w układzie koryta płyną z biegiem
  rzeki (atrybuty `aDist` – metry wzdłuż biegu – i `aSlope` – spadek koryta z wysokości terenu ±50 m); prędkość od
  ~0,5 m/s na nizinnych rzekach do 3 m/s na potokach. Na stromych ciekach (spadek ~2–6%) bystrza – smugi piany
  wydłużone z nurtem, przy szybkiej wodzie także przy brzegach; z daleka wygaszane.
- **Pola z bliska** (`src/terrain.js`): bruzdy na gołej ziemi (orka, podorywka – z bliska skiby co ~0,35 m, dalej
  przejazdy pługa co 3 m), fale wiatru przesuwające się po łanach zbóż (wiosną i latem, z siłą wiatru), bele słomy
  na ścierniskach zbóż (wczesna jesień) i siana na łąkach kośnych (lato) – co ~22 m, z cieniem od słońca, widoczne
  też z wysokości lotu. W palecie pór roku (`src/weather/seasons.js`): `balesStubble`, `balesHay`, `waves`.
- **Elewacje** (`src/buildings.js`): bloki – pastelowe pola co ~12 m (jak po termomodernizacji), balkony w całych
  pionach (balustrada w dolnej części kondygnacji, cień pod płytą), linie stropów; wszystkie budynki z oknami – ciemny
  cokół do 0,5 m i zabrudzenie przy ziemi, zacieki pod oknami, drzwi na parterze w części kolumn (domy częściej,
  bloki – klatki schodowe; nocą nie świecą jak okna). Szczegóły wygaszane z odległością.
- **Odbicia brzegu w wodzie w otwartym świecie** (`reliefReflect` w `src/world/reliefshade.js`, jak `reflectOcc`
  regionów): promień odbity od wody idzie w poziomie do ~420 m – las i zbocza na brzegu widać w jeziorach i rzekach
  jako ciemny, zielony pas zamiast nieba (z bliska okno gruntu, dalej zgrubne okno rzeźby).
- Poprawka: cienie rzeźby i przyciemnienie dolin w otwartym świecie znikały po pierwszym przesunięciu początku układu
  (po ~20 km lotu) – shader terenu podawał współrzędne z przesunięciem `worldOffset`, a okna rzeźby są w układzie gry.
- **Ostrzejsze cienie z bliska – dwie kaskady mapy cieni** (`src/shadows.js`): do dalekiej (±1,4 km, 4096², ~0,7 m
  na teksel, wszystkie rzucające cień) doszła bliska (±250 m wokół samolotu, 2048², ~0,24 m) – tylko warstwa
  `CASTER_NEAR` (budynki, mosty, aleje, słupy, bliskie drzewa), bez 360 tys. dalszych drzew. Cienie domów, koron
  i dachów z prostymi, ostrymi krawędziami zamiast rozmytych schodków; przy brzegu bliskiej kaskady płynne przejście
  w daleką. Koszt ~0,6 ms karty na klatkę.
- **Trawniki i łąki bez „kropek”** (`src/terrain.js`): malowane korony drzew w ogrodach zabudowy w układzie
  zniekształconym szumem, z poszarpanym brzegiem, a z bliska tylko jako lekki cień (wcześniej okrągłe ciemne plamy);
  pasy po koszeniu na trawnikach (co ~1,2 m, kierunek z działki, z bliska); wydeptane ścieżki – cienkie, kręte linie
  gołej ziemi w części łąk.
- **Piętra roślinności w górach** (`aboveTreeline` w `src/gfx/stand.js`, wspólne dla terenu i drzew): górna granica
  lasu ~1450 m (falująca ±80 m), wyżej kosodrzewina w płatach z murawą (drzewa 3D i odległe maleją do ~2–3 m),
  od ~1750 m hale (płowa murawa, bez drzew), od ~2050 m i na bardzo stromych stokach skała z warstwami i porostami,
  na stromych – piargi; nagi teren (WorldCover) w górach to skała, nie piasek; nad granicą lasu niższa „ściana lasu”
  w cieniach rzeźby.
- Poprawka: kafle przy granicy kraju (Tatry, Beskidy, Sudety) z częściowymi danymi GUGiK – braki uzupełniane
  z Terrarium na siatce kafla (129²) zamiast na siatce 65²; wcześniej odczyty poza tablicą dawały NaN: pionowe ściany
  na krawędziach kafli i czarny obraz, gdy kamera stała nad takim kafelkiem.
- **Las do 5 km**: drzewa 3D do 1,5 km (dotąd 1,1 km; okno gruntu 3,5 km zamiast 2,8 km, ta sama rozdzielczość
  5,5 m), dalej odległe drzewa (`src/forest.js`: `makeDistant`) – czworokąty zwrócone do kamery z eliptyczną koroną
  i normalną kuli (te same barwy pór roku, śnieg, cień rzeźby i chmur): 1,5–2,6 km jedno na 10 × 10 m, 2,6–5 km jedno
  na 20 × 20 m, korony odpowiednio większe (las tak samo zwarty); gęstość lasu i wysokość z okna gruntu, a dalej ze
  zgrubnego okna rzeźby (w regionach – z ich tekstur). Na każdej granicy pasm łagodne przenikanie, teren pokazuje dno
  lasu do 5 km, dalej korony z tekstury. Koszt odległych drzew ~1,4 ms karty na klatkę (widok nisko nad Zakopanem).
- **Drzewa kołyszą się na wietrze** (`src/forest.js`): pochylenie z wiatrem i kołysanie (faza i częstotliwość
  z losu drzewa), fale porywów przesuwające się przez las z wiatrem; ugięcie rośnie z kwadratem wysokości (pień
  u podstawy stoi), przy silnym wietrze wierzchołek 20-metrowego drzewa wychyla się o ~0,3 m. Cienie drzew kołyszą się
  razem z nimi (ta sama siatka w mapie cieni), wektory ruchu TAA znają położenie z poprzedniej klatki (bez smug).
- **Oznakowanie dróg** (`src/roads.js`): pasy ruchu z szerokości jezdni (~3,4 m na pas) – na jezdniach
  jednokierunkowych (autostrady, ekspresówki, drogi dwujezdniowe; nowy atrybut `aWay`) przerywane linie między pasami
  bez osi, na dwukierunkowych od 4 pasów podwójna ciągła oś i linie pasów, węższe – przerywana oś; farba starta
  w plamach. **Przejścia dla pieszych** (`src/gen/crossings.js`): zebry na wylotach skrzyżowań z drogą krajową,
  wojewódzką albo powiatową w zabudowie, za krawędzią najszerszej drogi w węźle; bez styków odcinków tej samej
  ulicy, bez nakładania się i nie w poprzek arterii szerszych niż 14 m – w otwartym świecie i w regionach.
- **Dachy** (`src/buildings.js`, `src/buildgeo.js`): dachówka z rzędami (cień pod krawędzią rzędu), stykami
  przesuniętymi co drugi rząd i różnym odcieniem pojedynczych dachówek; blacha (szare i zielone dachy)
  z przetłoczeniami co 0,5 m; ciemniejsze gąsiory na kalenicy, rynna przy okapie, zabrudzenia i mech nisko na połaci;
  dachy płaskie – pasy papy i łaty. Szczegóły wygaszane z odległością (z wysokości lotu – średnia jasność). Położenie
  na połaci w atrybucie rodzaju (okap 1 → kalenica 1,4), v – długość wzdłuż spadku. Kominy z cegły na ~85% domów
  jednorodzinnych (przy kalenicy, 0,9 m ponad nią).
- **Przyciemnienie gruntu przy budynkach i na skraju lasu** (otwarty świat): budynki i las „siedzą” w terenie –
  ciemniejszy pas przy ścianach (do ~15 m) i, słabiej, przed ścianą lasu (do ~14 m). Liczone raz w wątku kafla
  (`chunkOcclusion` w `src/world/chunkdata.js`: obrysy budynków i piksele lasu, transformata odległości) i zapisane
  w górnych 4 bitach klasy pokrycia w teksturze kafla – bez dodatkowej pamięci i bez kosztu na karcie; w shaderze
  głównie światło nieba i odbite, słońce słabiej.
- **Poranna mgła w dolinach** (otwarty świat, `src/post.js`): od świtu do ~10:00 przy słabym wietrze i niezbyt
  pochmurnym niebie (najwięcej jesienią, mniej latem; w deszczu i burzy – nie; `valleyFog` w `src/weather/weather.js`)
  mgła wypełnia dna dolin, koryta rzek i żleby – tam, gdzie grunt leży pod poziomem okolicy (wysokość wygładzona
  w promieniu ~500 m: kanał A okna rzeźby, liczony w tle po 48 wierszy na klatkę); jęzory i plamy z szumu, grzbiety
  i korony drzew wystają ponad warstwę; oświetlona słońcem i niebem. Koszt karty w granicach szumu pomiaru.
- **Wyostrzenie obrazu i poświata jasnych świateł** (`src/post.js`): po wygładzaniu TRAA wyostrzenie z adaptacją
  do kontrastu (RCAS, `SharpenNode`) – ostrzejsze krawędzie budynków, korony drzew i linie pól; poświata (`BloomNode`)
  tylko tego, co po ekspozycji jaśniejsze od bieli – światła miast i reflektory nocą, odblask słońca, błyskawice;
  obraz do poświaty mnożony przez bieżącą ekspozycję, więc próg działa tak samo w dzień i w nocy. Ustawienia → Obraz:
  „Poświata jasnych świateł” (0–2) i „Wyostrzenie obrazu” (0–1). Koszt karty graficznej w granicach szumu pomiaru.
- **Cienie rzeźby terenu w otwartym świecie** (dotąd tylko w regionach): przy niskim słońcu grzbiety rzucają cienie
  przez doliny (promień do słońca do ~4,4 km), polany i drogi w lesie ciemnieją przy ścianach drzewostanu, doliny
  i wąwozy ciemniejsze w świetle nieba. Dane: zgrubne okno rzeźby wokół kamery (`src/world/relief.js`, 28 km,
  ~55 m na piksel, z kafli bliskich i dalekiego terenu) i okno gruntu drzew 3D z bliska; shader wspólny
  (`src/world/reliefshade.js`) – teren kafli i daleki teren, drzewa 3D (raz na drzewo) oraz przez
  `plane.groundShadow` budynki, drogi, aleje, mosty, rzeki, tory i pojazdy. Koszt karty graficznej w granicach
  szumu pomiaru (Beskid Śląski, 2,6–8,3 ms na klatkę bez zmian).
- **Barwy pór roku** (`src/weather/seasons.js`, uniformy `SEASON` w `src/gfx/ground.js`): wiosną kwitnący rzepak,
  młode zboża, goła ziemia pod kukurydzę, świeża jasna zieleń łąk i liści; latem jak dotąd; wczesną jesienią
  ścierniska, orka i wschody ozimin, sucha kukurydza, przyżółkła trawa i pierwsze żółknące liściaste (ok. 1/5
  drzew); zimą – oziminy i ziemia pod śniegiem, zżółkła trawa. Pola, łąki, polany, ogrody, drzewa 3D, aleje
  i korony dalekiego lasu – w regionach i w otwartym świecie; zmiana pory roku w locie od razu.
- **`npm run bake:tiles` dla wielu województw**: `-- malopolskie opolskie` albo `-- polska`; kafle wektorowe z
  wyciągu całej Polski (`--osm=poland`, domyślnie) w osobnym katalogu `tools/.cache/tiles-src/vector-poland/` –
  Planetiler nie nadpisuje już `data/tiles/lot/`, kolejne województwo nie usuwa poprzednich; Planetiler tylko
  w prostokącie wypiekanych województw (`--bounds`) – kilkaset MB zamiast kilku GB na dysku. Brakujące wyciągi i
  pliki `.poly` pobierane z Geofabrik.
- **Bez pasa OpenFreeMap na granicach województw**: obszar bierze kafle z14, które go dotykają i leżą w całości
  w wyciągu kraju – kafle przecięte granicą mają dane z obu stron; należą do województwa wypieczonego ostatnio.
- **Opis `tiles.json` w wersji 4** (`src/gen/lotmanifest.js`, wspólny dla narzędzia, wątku kafli i menu): kafle z14
  maskami po kaflach z11 (Śląskie 5 kB zamiast 64 kB), osobny znacznik wypieczenia każdego województwa w kluczach
  pamięci kafli – nowe województwo nie unieważnia pobranych kafli pozostałych. Stary opis (v3) nadal czytany;
  przy pierwszym uruchomieniu Śląsk raz pobierze się na nowo (nowy klucz pamięci).
- **Kafle województwa w jednym pliku – `data/tiles/lot/<województwo>.pmtiles`** (PMTiles v3): kafle wektorowe
  z14 (gzip), pokrycie i wysokości z14 i z11 obszaru. Na serwer gry: `tiles.json` (spis – który kafel należy do
  którego województwa) i pliki `.pmtiles` zamiast dziesiątek tysięcy plików (Śląsk: 15 602 kafle, 157 MB;
  Małopolska: 18 855 kafli, 215 MB). Po wypieczeniu kolejnego województwa wgrywa się tylko jego plik i nowy
  `tiles.json`. Gra otwiera archiwum województwa przy jego pierwszym kaflu i pobiera pojedyncze kafle zapytaniami
  o fragment pliku (HTTP Range), z tą samą pamięcią kafli w przeglądarce; bez archiwum albo przy serwerze bez Range –
  luźne pliki `data/tiles/lot/` jak dotąd. `npm run pack:tiles [-- <województwo…>]` pakuje istniejące kafle,
  `bake:tiles` pakuje sam wypieczone województwa, `npm run web` kopiuje spis i archiwa do `web/lot/`. `server.js`
  obsługuje zapytania Range i wysyła pliki strumieniem.
- **Archiwa kafli w wersjach gry**: aplikacja desktopowa (`npm run dist`) zawiera spis i archiwa województw (poza
  `app.asar`), a protokół `app://` odpowiada na zapytania o fragment pliku – kafle województw z dysku, bez pobierania
  (daleki teren i mapa poza województwami – nadal z sieci). `npm run app:check` sprawdza archiwum. Wersja web –
  spis i archiwa w `web/lot/data/tiles/lot/` (bez ZIP).
- **Ekran startowy – postęp kompilacji shaderów** (jak w Maszyniście): „Kompilacja shaderów… X z Y” (obiekty sceny),
  potem „Kompilacja potoków karty graficznej… X z Y” i „Kompilacja efektów obrazu…” – shadery sceny kompilowane
  z góry przez `compileAsync` (ten sam bufor i wyjścia co przebieg sceny, potoki karty równolegle, przerwy dla
  ekranu co 100 ms), resztę (efekty końcowe, cienie, chmury) kompiluje pierwsza klatka. Ekran nie stoi już kilku
  sekund bez zmian (zamrożenie ok. 3 s → 1,5–2 s), ale całe przygotowanie trwa ok. 1,5–2 s dłużej.
- Poprawka: wątek sieci ruchu czytał opis kafli w starej postaci – w województwach z własnymi kaflami samochody
  i pociągi jeździły po drogach z OpenFreeMap.

## 0.35 – zima

- **Pora roku „Zima”** (plan lotu i pogoda w locie): 3 stycznia, pełnia – niskie słońce i krótki dzień.
- **Śnieg na ziemi przy każdej pogodzie** (`WINTER_SNOW` = 0,75 – w plamach widać ściernisko i łąki); przy pogodzie
  „Śnieg” – pełna pokrywa. Zmiana pory roku w locie – śnieg narasta i topnieje stopniowo.
- **Opady**: zimą deszcz pada jako śnieg, burza – jako śnieżyca z grzmotami (`seasonWeather` w `src/weather/weather.js`).
- **Drzewa liściaste bez liści**: brązowoszare korony z prześwitami (widać przez nie śnieg na ziemi), także w alejach
  i na dalekim terenie; sosny i świerki zielone.

## 0.34 – otwarty świat dla każdego (beta)

- **Menu główne → „Otwarty świat · cała Polska · beta”**: osobny ekran wyboru miejsca startu – 10 gotowych miejsc
  (Śląsk, Kraków, Zakopane, Wrocław, Warszawa, Gdańsk, Mazury), wyszukiwarka miejscowości (rodzaj i położenie jak
  w „Skok do”), ostatni start; karta z położeniem i jakością mapy, przycisk „Leć tutaj”. Regiony zostają trybem
  głównym.
- **Jakość mapy przy każdym miejscu**: „pełna jakość” na wypieczonych kaflach własnych (Śląsk – rodzaje i dachy
  budynków, linie energetyczne, rzeźba GUGiK), „podstawowa” poza nimi (OpenFreeMap i AWS Terrain Tiles). Liczona
  z listy kafli z14 w `data/tiles/lot/tiles.json` (bez niego – wszędzie podstawowa).
- **W locie**: podpowiedź przy wejściu do otwartego świata; komunikat przy wlocie i wylocie z obszaru pełnej jakości;
  komunikat, gdy kafle nie dochodzą (brak internetu albo serwer kafli nie odpowiada).
- Bez etykiet „DEV”: przycisk „Otwarty świat stąd” w generatorze i wpis na liście regionów („BETA”). Skok w dowolne
  miejsce zostaje w trybie deweloperskim.

## 0.33 – skok w dowolne miejsce (tryb deweloperski)

- **Panel H – pole „Skok do”**: nazwa miejscowości (wyszukiwarka jak w generatorze; kilka wyników – lista z rodzajem
  miejsca, powiatem i województwem oraz odległością i kierunkiem od samolotu, np. Wisła – rzeka albo miasto; dubel
  gmina/miasto scalony)
- Poprawka: skok w miejsce bez kafli w pamięci (np. Wisła → Zabrze) – w trakcie doczytywania pętla gry cofała
  przesunięcie początku układu i samolot lądował w starym miejscu; teraz w czasie skoku przesunięcia nie ma.
  albo współrzędne (`50.06, 19.94`, `50,06 19,94`, `50.06N 19.94E`, odwrócona kolejność dla Polski też); przyciski
  „Start”, „+10 km” (w kierunku lotu) i 5 ostatnich skoków (pamiętane w przeglądarce).
- **Duża mapa (Tab) – Shift+klik**: skok w wskazane miejsce (zwykły klik – nadal cel lotu); podpowiedź w pasku mapy
  tylko w trybie deweloperskim.
- Skok: 400 m nad terenem, kurs i prędkość bez zmian. Otwarty świat do 150 km – na miejscu (przesunięcie początku
  układu, doczytanie okolicy pod małą kartą; ~0,5 s z pamięci kafli), dalej – otwarty świat od nowa w tym miejscu
  (skala rzutu Mercatora z nowej szerokości); region – w jego granicach, poza nimi – otwarty świat w tym miejscu.
  W trakcie wczytywania – komunikat „Poczekaj…” zamiast cichego pominięcia.

## 0.32 – piesi tam, gdzie chodzą ludzie

- **Liczba pieszych z długości chodników wokół** (~22 na km przy pełnym ruchu, najwyżej 1500): wieś – kilkunastu,
  śródmieście – setki; wcześniej wszędzie ten sam cel (do 1500 w promieniu 800 m), więc poza miastami tłum
  stłoczony na kilku ulicach. Długość – części krawędzi w kole (dokładnie, nie po środkach odcinków).
- **Bez pieszych na drogach szybkiego ruchu**: ulice i ścieżki tylko w zabudowie (poza nią – nieliczne ścieżki),
  drogi główne i zbiorcze tylko w zabudowie i nie dwujezdniowe (jednokierunkowe jezdnie tras ekspresowych); piesi
  nie skręcają też na skrzyżowaniach w drogi poza zabudową (wcześniej rozchodzili się z osiedli po całej sieci).
- Zabudowa krawędzi sprawdzana w jej środku wzdłuż (wcześniej – w drugim z jej punktów, czyli na końcu).

## 0.31 – obiekty kafli w wątkach, odrzucanie poza kadrem

- Rzeki, tory, mosty i perony, aleje i linie energetyczne liczone w wątku kafli (`src/objgeo.js` – te same funkcje
  używają regiony, `create…` = tablice + siatki z `…FromArrays`), sfery otaczające budynków też w wątku: budowa
  obiektów kafla w wątku głównym 4,7 → 0,9 ms (najwyżej 2,2 ms).
- **Odrzucanie poza kadrem w otwartym świecie**: kafle terenu, dalekiego terenu i wszystkie obiekty kafli mają sfery
  otaczające (z zapasem na krzywiznę Ziemi) – three nie wysyła do karty tego, czego nie widać, a przebieg mapy cieni
  rysuje tylko budowle w jej obszarze. Pomiar pokazał, że klatka była ograniczona procesorem (wysyłanie ~900 obiektów
  ~20 ms, karta ~5 ms): teraz 569 wywołań rysowania, render 19,9 → 9,2 ms; klatka nad Katowicami 25 → 17,8 ms
  (w locie 28 → 20,5 ms, 95% klatek 52 → 32 ms).

## 0.30 – drobne poprawki otwartego świata

- **Bez uskoku na styku terenu bliskiego i dalekiego w górach**: daleki teren w obszarze własnych kafli też z GUGiK
  (kafle z11, siatka 65²); poza Polską (brak danych – znacznik w pliku) rzeźba uzupełniana z Terrarium.
- **Przesunięcie początku układu bez mignięcia wygładzania**: historia TRAA od nowa w klatce przesunięcia (three
  trzyma poprzednie macierze kamery u siebie – wektory ruchu tej jednej klatki byłyby błędne).
- **Pociągi**: sieć torów do 12 km (wcześniej 9) – składy nie dojeżdżają do sztucznego końca sieci, gdzie
  zawracałyby jak na końcu toru.
- Poprawka: perony z zdegenerowanym obrysem dawały wierzchołki NaN w siatce mostów i peronów (błędy
  „computeBoundingSphere … NaN” w konsoli, także w regionach).
- Skala rzutu Mercatora (~1% na 100 km na płn./płd. od startu) – świadomy kompromis (przesunięcie początku jako
  czyste przesunięcie), opisany w README.

## 0.29 – wydajność otwartego świata

- Pomiar: `?prof` w adresie włącza znaczniki czasu GPU (`__lot.gpuTime()`), a pomiar warstw – na przemian
  z warstwą i bez (pętla gry wstrzymana): nad Katowicami klatka 19 ms, z tego stały koszt nieba, chmur
  i obrazu końcowego 5,9 ms, teren bliski 3,6, las 3D 1,9, szczegóły (drzewa przydrożne, przewody) 1,6, woda
  z torami i mostami 1,1, daleki teren 0,8; trójkąty terenu nie są wąskim gardłem (połowa siatki – ten sam czas),
  tylko cieniowanie pikseli.
- Drzewa przydrożne i przewody tylko do ~2–2,5 km od kamery (słupy dalej): szczegóły 1,6 → 0,3 ms.
- Teren kafli: gęstość lasu i odległość od brzegu z jednego odczytu tekstury (12 → 8 odczytów na piksel).
- Daleki teren: pola bez podziału na pasy i prostszy szum wilgotności (z ~10 km niewidoczne) – 0,5–0,9 ms.
- Razem: klatka w grze nad Katowicami (250 m nad terenem) – mediana 23,1 → 22,7 ms, 95% klatek 30,8 → 29,4 ms;
  reszty nie da się zbić bez straty jakości (cieniowanie terenu jak w regionach).

## 0.28 – jakość obrazu otwartego świata

- **Rzeźba z GUGiK** w obszarze własnych kafli: numeryczny model terenu z LIDAR (usługa WCS GUGiK, w układzie Web
  Mercator – piksele dokładnie w wierzchołkach siatki), siatka 129² (~12 m) zamiast 65² z Terrarium (~24 m, dane
  ~30 m) – ostre doliny, skarpy, nasypy, hałdy. Dalej niż ~6 km od samolotu – co drugi wierzchołek (histereza
  5–6 km; obiekty stoją tylko na pełnej siatce).
- **Pokrycie terenu 256²** (~6 m) zamiast 128² – gładsze brzegi lasów, pól i wody (także na kafelkach OpenFreeMap).
- **Las w miastach**: drzewa z WorldCover w zabudowie OSM (osiedla, usługi, przemysł – poza lasem z OSM) jako
  zabudowa – bez gęstych lasów 3D w ogrodach i na skwerach.
- **Brzegi wody** w otwartym świecie: odległość od brzegu liczona w wątku kafla (kanał G tekstury pokrycia) – płycizny
  przy brzegu, głęboka toń w nurcie, piana na linii brzegu jak w regionach.
- Las z daleka – jasność dopasowana także przy niskim słońcu (pomiar w południe i o 7:30).
- Klucze pamięci kafli ze znacznikiem wypieczenia – po ponownym `bake:tiles` gra nie bierze starych kafli z IndexedDB.

## 0.27 – własne kafle (pilot: województwo śląskie)

- **Własne kafle otwartego świata**: `npm run bake:tiles -- slaskie` buduje z wyciągu OpenStreetMap (Geofabrik)
  kafle wektorowe ze schematem gry (Planetiler, `tools/tiles/lot-schema.yml` – surowe znaczniki OSM) i rastry
  pokrycia terenu z ESA WorldCover 10 m (z14 i z11) do `data/tiles/lot/`; gra używa ich w kaflach w całości wewnątrz
  obszaru (granica z pliku .poly), poza nim – OpenFreeMap. Śląskie: 5210 kafli z14, 123 MB, ~2 minuty.
- Z własnych kafli: **rodzaje budynków i dachy z OSM** (kościoły z wieżą, bloki, hale, gospodarcze), nawierzchnie
  dróg, **linie energetyczne ze słupami i przewodami**, **szpalery drzew**, przejazdy kolejowe, pokrycie terenu
  10 m zamiast wielokątów mapy (dokładniejsze brzegi lasów i zabudowy), woda z OSM na wierzchu.
- Aleje i linie energetyczne (`createDetails`) także w otwartym świecie – na OpenFreeMap aleje wzdłuż części dróg
  lokalnych, na własnych kaflach także szpalery i linie z danych.
- **Obiekty kafli liczone w wątkach**: geometria budynków (`src/buildgeo.js`) i dróg (`src/gfx/ribbon.js`)
  w wątku kafli, w wątku głównym tylko siatki z tablic – ~5 ms na kafel zamiast ~90 ms (bez zacięć nad miastem).
- Poprawka: nazwy miejscowości w krajobrazie – punkty za kamerą (przy odwróconym buforze głębi trafiały w ekran
  odbite, np. „Mysłowice” na niebie); podpisy z krzywizną Ziemi.

## 0.26 – lasy górskie, wyprzedzające doczytywanie, pamięć kafli

- **Lasy w górach**: powyżej ~350–650 m n.p.m. siatka oddziałów rozmyta w nieregularne płaty, bez duktów, mniej
  zrębów i młodników, więcej buka na niższych stokach (do ~900 m), wyżej świerk – w terenie i w drzewach 3D
  (te same drzewostany); także w regionie Beskid Śląski. Bory nizinne bez zmian.
- **Doczytywanie z wyprzedzeniem**: kafle także wokół punktu 25 s lotu przed samolotem (do 3 km), te z przodu
  w pierwszej kolejności – szybkie maszyny nie wlatują w niewczytany teren.
- **Pamięć kafli** w przeglądarce ograniczona do 1 GB (najwyżej 30% przydziału): rejestr ostatniego użycia kafli,
  przycinanie co 10 minut lotu w otwartym świecie – najdawniej używane kafle wylatują.
- **Las z daleka**: korony z tekstury poza zasięgiem drzew 3D przyciemnione do ich jasności (pomiar średniej jasności
  obrazu w obu strefach: 103 → 65 przy 60 w strefie drzew) – bez jasnego pierścienia wokół samolotu; też w regionach.
- **Miejsca startu w otwartym świecie**: do 10 miast i miasteczek z mapy w promieniu 40 km (z kierunkiem
  i odległością od startu) – start w innym mieście bez przeładowania; doczytywanie trzyma się nowego miejsca do
  końca wczytywania. Daleki teren (z11) daje też nazwy miejscowości i płytki dużej mapy do 50 km.
- Wydajność: daleki teren i podłoga rysowane po kaflach z14 (zasłonięte piksele odpadają na teście głębi) –
  ~5 ms zamiast ~11 ms na klatkę.

## 0.25 – otwarty świat bez granic, daleki teren

- **Przesuwanie początku układu**: otwarty świat liczony w rzucie Mercatora o stałej skali (z szerokości startu) –
  przesunięcie początku to czyste przesunięcie. Gdy samolot odleci ~20 km, początek przesuwa się pod niego o
  wielokrotność 14 080 m: kafle, siatki, okna gruntu i świateł, mapa, sieci ruchu, ptaki, kamery i chmury
  przesunięte w miejscu (~20 ms, bez wczytywania), wzory proceduralne (pola, drzewostany, rozmieszczenie drzew,
  nawierzchnie) liczone w układzie stałym względem Ziemi (`worldOffset`) – krajobraz się nie zmienia.
  Lot bez ograniczenia ~150 km; zapis lotu pamięta początek układu.
- **Daleki teren z rzeźbą**: kafle z11 (~12,5 km) do 50 km – rzeźba Terrarium z11, pokrycie z mapy z11, ten sam
  shader gruntu; pod wczytanymi kaflami z14 odrzucany (maska), styk zasłaniają „fartuchy” kafli. Góry na horyzoncie
  (z Beskidów widać Babią Górę).
- Poprawka: kafle wysokości pod kaflem – wszystkie w pokrytym prostokącie (wcześniej tylko narożne).

## 0.24 – mapa i noc w otwartym świecie

- **Minimapa i duża mapa** w otwartym świecie: płytki mapy z kafli (pokrycie, cieniowanie rzeźby, cieki, drogi,
  tory) rysowane po jednej na klatkę i pamiętane (do 400) – przeleciany obszar zostaje na mapie; minimapa i duża
  mapa rysują mapę przez wspólny interfejs (`regionBase` dla regionów, `WorldMap` dla świata).
- **Nazwy miejscowości** z kafli: opis położenia („nad miastem Katowice · Śródmieście”), podpisy w krajobrazie i na
  mapach – lista rośnie z doczytywaniem.
- **Światła osad nocą**: latarnie liczone dla każdego kafla (ulice w zabudowie), poświaty wszystkich wczytanych
  kafli w jednym spricie, plamy światła na ziemi w oknie wokół kamery; okna budynków jak w regionach.
- Podmiana sieci ruchu bez zacięcia: krok na klatkę (samochody, pociągi, piesi), samochody przepinane po 300 na krok
  – do tego czasu jadą po starym grafie (pasy i przyczółki osobno dla każdego grafu). Podmiana ~5 ms zamiast ~30 ms.

## 0.23 – otwarty świat (wersja rozwojowa)

- **Otwarty świat** jako osobny tryb w rozwoju: generator → „Otwarty świat stąd” – kafle mapy (OpenFreeMap z14)
  i rzeźby (Terrarium z12) doczytywane w locie wokół samolotu w wątkach, z pamięcią w przeglądarce; teren 9 km,
  drogi, budynki, rzeki i tory 4 km, zwalnianie za zasięgiem. Regiony bez zmian.
- Teren kafli tym samym shaderem co regiony: materiał gruntu wydzielony z `src/terrain.js` (`shadeGround`) – region
  podaje swoje rastry, kafle swoje (tekstura warstwowa pokrycia, siatka i normalne z wątku).
- Budynki i drogi kafli ze wspólnymi materiałami (`createBuildings` z parametrem `shared`, `makeRoadMaterial`); tak
  samo rzeki, tory, mosty i perony.
- **Drzewa 3D** w otwartym świecie: las regionów czyta „okno gruntu” wokół kamery (gęstość lasu, wysokość, maska dróg
  z kafli), przesuwane pasami; brzeg lasu w terenie kafli liczony tak samo jak przy drzewach.
- **Ruch uliczny, pociągi i piesi** w otwartym świecie: sieć dróg i torów budowana w osobnym wątku co ~2 km lotu,
  przekazywana w tablicach; pojazdy i pociągi przepinane na nowy graf bez znikania.
- Testy: rama kafla, kafle wysokości, siatka i normalne, kafle wokół punktu, wysokość na trójkątach siatki, maska
  dróg kafla, pakowanie sieci, przepinanie pojazdów i pociągów na nową sieć.

## 0.22 – nowe samoloty

- **PZL Mielec An-2** – dwupłat: górne skrzydło na grzbiecie (sloty, lotki), dolne przy podłodze, słupki „I” i cięgna,
  silnik gwiazdowy w osłonie z żaluzjami, czterołopatowe śmigło, okrągłe okna kabiny pasażerskiej, drzwi, zastrzały
  usterzenia; najwolniejszy (przeciąga ~55 km/h) i najbardziej ociężały w przechyle; SP-ANT, dwa fotele obok siebie.
- **PZL-130 Orlik** – turbośmigłowy samolot szkolny: długi nos z rurami wydechowymi, pięciołopatowe śmigło, owiewka
  tandem z instruktorem z tyłu; akrobacyjny (~170°/s przechyłu, do ~415 km/h); podwozie trójkołowe chowa się samo
  powyżej ~180 km/h i wypuszcza przy zwolnieniu; szachownice z obwódką na skrzydłach i stateczniku, numer 042.
- **PZL P.11c** – przedwojenny myśliwiec: skrzydło mewie Puławskiego z zastrzałami, silnik Mercury w pierścieniu
  Townenda z widocznymi cylindrami, drewniane dwułopatowe śmigło, otwarta kabina z wiatrochronem i celownikiem;
  khaki z błękitnym spodem, szachownice na skrzydłach i sterze kierunku; tylko światła pozycyjne (bez stroboskopów,
  błyskacza i reflektorów).
- Dźwięk: brzmienia nowych silników, gwizd turbiny Orlika.
- Części wspólne: otwarta kabina w kadłubie z przekrojów, szachownica lotnicza.
- Menu: „Zapisz lot” i „Wczytaj lot” połączone w jeden ekran „Zapisz / wczytaj” (jak w Maszyniście) – przy każdym
  slocie przyciski Zapisz / Nadpisz, Wczytaj i usuń; nadpisanie, usunięcie i wczytanie w locie z potwierdzeniem.

## 0.21 – ptaki z daleka

- Odległe ptaki jako drobne, migoczące kropki w barwie gatunku (nakładka po wygładzaniu, zasłaniana przez budynki
  i teren) zamiast sztucznie powiększonych brył; z bliska – pełne modele w naturalnej wielkości.
- Poprawne wektory ruchu ptaków dla wygładzania TRAA – bez smug.

## 0.20 – ptaki z bliska

- Osobne modele gatunków: bocian (szyja, nogi, czerwony dziób), myszołów i wrona z rozcapierzonymi lotkami, mewa ze
  skrzydłami w „W”, szpak ze spiczastymi; barwy upierzenia.
- Animacja: zgięcie w barku i nadgarstku, szybkie uderzenie w dół, ugięta dłoń przy powrocie, podskok tułowia,
  szybowanie w „V”; rytm machania zależny od gatunku.
- Przechył w zakrętach i pochylenie przy wznoszeniu.

## 0.19 – duża mapa i cel lotu

- Duża mapa regionu (Tab, menu pauzy): przesuwanie, powiększanie, nazwy, podziałka; kliknięcie – cel lotu.
- Prowadzenie do celu: odległość, czas dolotu i skręt w panelu, znacznik na pasku kursu i minimapie, komunikat u celu.
- Opcja: nazwy miast nad krajobrazem.
- Minimapa w kształcie pozostałych paneli (zaokrąglony kwadrat z tłem i ramką, skala w środku panelu).

## 0.18 – minimapa

- Minimapa w rogu ekranu: lasy, pola, woda, zabudowa, rzeźba, drogi i tory, nazwy miejscowości, miejsca startu.
- Skale 2 / 5 / 15 km (N), kurs albo północ u góry (Shift+N); wyłączenie w ustawieniach.

## 0.17 – nawigacja w locie

- Pasek kursu (kompas) u góry ekranu i panel położenia: miejscowość z dzielnicą, odległość i kierunek od ważnej
  miejscowości, współrzędne, wiatr względem samolotu, ostrzeżenie o granicy mapy z kursem powrotu.
- Nazwy miejscowości regionów (do 900) z kafli OpenFreeMap – `npm run bake:labels`; generator zapisuje je od razu.

## 0.16 – upływ czasu

- Czas w locie płynie: zatrzymany, rzeczywisty, ×10, ×60; wybór w planie lotu i na pauzie, klawisze T (stop / start)
  i Shift+T (przyspieszenie); przejście przez północ do następnego dnia.
- Zegar z datą i tempem w panelu lotu.

## 0.15 – piesi

- **Piesi** na chodnikach, deptakach i ścieżkach w zabudowie, czekający na peronach – widoczni z niska (poniżej
  ~350 m), z krokiem, różnymi ubraniami i wzrostem; w deszczu parasole.
- Natężenie zależne od godziny i pogody; gwar w dźwięku; przełącznik „Piesi” w ustawieniach.
- Sieć ścieżek budowana na bieżąco w okolicy kamery (bez wydłużania wczytywania).

## 0.14 – ptaki

- **Ptaki** zależne od miejsca, pory dnia i roku oraz pogody: stada szpaków (o zmierzchu wielkie, falujące),
  bociany, krążące myszołowy, mewy nad wodą, wrony nad miastami.
- Stada płoszone przez przelatujący samolot, zderzenie z ptakiem.
- Machanie i szybowanie, głosy ptaków, trzepot stada; przełącznik „Ptaki” w ustawieniach.

## 0.13 – kolej

- **Pociągi** na torach regionu: regionalne zespoły elektryczne, Intercity, towarowe z węglarkami i cysternami,
  wąskotorowe; postoje na stacjach i przystankach, zmiana kierunku na końcu toru, tylko łagodne rozjazdy.
- Wagony wyginające się na łukach i pochylające na wzniesieniach, nocą oświetlone okna, reflektory i światła końca.
- Dudnienie, stukot i sygnał pociągu; przełącznik „Ruch kolejowy” w ustawieniach.
- Poprawka siatki przestrzennej dróg i torów: długie proste odcinki nie przeskakują komórek.

## 0.12 – ruch uliczny

- **Samochody, dostawczaki, ciężarówki i autobusy** na drogach wokół samolotu: prędkość i gęstość zależne od klasy
  drogi, pory dnia (szczyty), pogody; odstępy, skrzyżowania, ruch prawostronny, jednokierunkowe, mosty.
- Nocą reflektory i czerwone światła tylne – strumienie świateł na głównych drogach.
- Sieć dróg z danych regionu z łączeniem skrzyżowań zgubionych w kaflach wektorowych; kierunek jednokierunkowy
  w danych dróg (regiony wbudowane wypieczone ponownie).
- Szum ruchu w dźwięku, suwak „Ruch uliczny” w ustawieniach.

## 0.11 – kominy i chłodnie

- Kominy elektrowni, ciepłowni i kopalń, chłodnie kominowe i zbiorniki rozpoznawane z kształtu obrysu (kafle mapy
  nie mają rodzaju budynku) – bez okien, więc nocą już nie świecą jak bloki.
- Chłodnie w kształcie hiperboloidy, kominy od 100 m z biało-czerwonymi pasami, nocą migające czerwone światła
  przeszkodowe.

## 0.10 – pogoda

- **Deszcz, śnieg i burza** w planie lotu i na pauzie: krople i płatki na GPU wokół kamery (smugi pędzące na szybę
  lecącego samolotu), zasłona opadu w oddali, niska i gęsta warstwa chmur.
- **Śnieg na ziemi**: pola i korony drzew stopniowo bieleją.
- **Burza**: błyskawice z odgałęzieniami, rozświetlenie nieba i chmur, grzmot opóźniony o odległość.
- **Wiatr** do wyboru (cisza … wichura): znoszenie samolotu, porywy, turbulencja, szybsze chmury; w raporcie lotu.
- Dźwięk pogody: deszcz i bębnienie o kabinę, wiatr z porywami, grzmoty.

## 0.9 – dźwięk

- **Dźwięk syntezowany w Web Audio** (bez plików nagrań): silnik z tonem zapłonów zależnym od obrotów i od maszyny
  (gwiazdowy Dromadera i Wilgi, bokser Extry), pulsujący wydech, świst śmigła z przejściem łopat, wiatr rosnący
  z prędkością, toczenie po ziemi.
- Brzęczyk przeciągnięcia, przyziemienie (uderzenie i pisk opon zależny od opadania), kraksa i wybieg silnika.
- Inne brzmienie w kabinie i z zewnątrz (odległość kamery, tłumienie wysokich tonów), cichy silnik w menu,
  przytłumienie na pauzie.
- Dźwięki menu: wskazanie, kliknięcie, wybór, powrót, sygnał gotowości po wczytaniu.
- Ustawienia → Dźwięk (głośność ogólna, silnika, otoczenia, dźwięki menu), klawisz M – wyciszenie.

## 0.8 – generator regionów, Zabrze i Beskid Śląski

- **Nowe regiony wbudowane** (46 × 46 km, kafle OpenStreetMap, rzeźba szczegółowa): **Zabrze** – teraz domyślny
  (Gliwice, Katowice, Bytom, Ruda Śląska, Chorzów; 470 tys. budynków) i **Beskid Śląski** (Szczyrk, Bielsko-Biała,
  Wisła, Ustroń, Żywiec, Skoczów; do 1549 m n.p.m.), z odmianą nazw w opisie położenia.
- `npm run bake:gen` – wypiekanie regionów wbudowanych tym samym rdzeniem co generator w grze.
- **Generator regionów w grze** (menu → Regiony i generator map): środek z wyszukiwarki miejscowości (Nominatim) albo
  z propozycji (Katowice, Gliwice, Beskid Śląski, Jura, Częstochowa, Tatry, Kraków, Trójmiasto, Warszawa, Wrocław),
  bok 20 / 30 / 46 / 60 km, rzeźba standardowa (2048², z12) lub szczegółowa (4096², z13), budynki wszystkie / bez
  małych / bez budynków.
- **Kafle wektorowe OpenStreetMap** (OpenFreeMap, schemat OpenMapTiles, z14): drogi z mostami i nawierzchnią, tory,
  perony i stacje, budynki z wysokością, cieki, woda i pokrycie terenu (las, łąki, pola, zabudowa, mokradła)
  rastrowane do mapy pokrycia; miejsca startu z miast i wsi regionu.
- Własny dekoder MVT i przycinanie obiektów do kafli – działa w workerze, gra nie zacina się podczas generowania.
- **Kafel po kaflu w IndexedDB**: pobrane kafle zostają w przeglądarce (drugi region w tej samej okolicy i przyszłe
  strumieniowanie bez ponownego pobierania), gotowe regiony – w tym samym formacie co wypieczone, działają bez sieci.
- Szacunek przed generowaniem (kafle, pobranie, liczba budynków i dróg, obciążenie gry) z próbki 9 kafli.
- Ekran postępu z możliwością przerwania; lista regionów z przełączaniem i usuwaniem; zapisy lotów osobno dla regionu.
- Obróbka terenu (wygładzanie wody, odległość od brzegu) wspólna dla narzędzia wypiekania i generatora.

## 0.7 – menu, samoloty do wyboru, wczytywanie

- **Wersja przeglądarkowa i aplikacja desktopowa** (jak w Maszyniście i Pograniczu Galaktyki): `npm run web` składa
  pliki strony w `web/lot/` i ZIP, `npm run app` / `npm run dist` – gra w oknie Electron i instalator dla Windows;
  ikona aplikacji i strony, „Wyjdź z gry” w aplikacji. Poprawka: brak światła latarni na drzewach (błąd shadera lasu).
- **Menu w stylu Pogranicza Galaktyki i Maszynisty**: ekran startowy z logo i „Kliknij lub naciśnij dowolny klawisz”,
  menu nad żywą sceną (Dromader krąży na autopilocie, kamera go okrąża), rama z celownikami i pasem skanu.
- **Plan lotu**: samolot, miejsce startu (Tuchola, Jezioro Charzykowskie, Chojnice, Rytel, Czersk, Człuchów), pora
  dnia, pora roku, pogoda, widok na starcie – wybór od razu zmienia scenę w tle.
- **Pauza (Esc)** z raportem lotu (położenie słownie, prędkość, wysokość, kurs, czas), szybka zmiana pogody i pory.
- **Zapisy**: 5 slotów i autozapis (co 30 s i przy wyjściu do menu), „Kontynuuj lot”, okno kraksy z „Leć ponownie”.
- **Ustawienia** w zakładkach Obraz / Sterowanie / Interfejs, zapamiętywane w przeglądarce.
- **Nowe samoloty**: PZL-104 Wilga 35 (górnopłat STOL, widok w dół przez drzwi) i Extra 330LX (akrobacyjny – beczki,
  lot na plecach), każdy z własnym modelem, kabiną, światłami i modelem lotu.
- **Ekrany wczytywania jak w Maszyniście**: przy starcie lotu, wczytaniu zapisu i ponownym starcie – animowany
  przelot nad polami, karta z planem lotu, etapy i wskazówki; mała karta przy zapisie i budowie nowej maszyny.
- Wspólny pasek przewijania w barwach gry, miękkie znikanie treści na krawędziach okien.
- Poprawki: drżenie skrzydeł w menu (regulator autopilota), opisy pól wyboru w jednej linii, panel deweloperski
  ukryty domyślnie (włączany w ustawieniach, klawisz H).

## 0.6 – samolot z bliska, kabina, noc

- **Nowy model Dromadera**: kadłub z przekrojów, przeszklona kabina z ramami, silnik gwiazdowy z cylindrami, ruchome
  lotki i stery, belka oprysku, linka do statecznika, znaki SP-DRB, lakier z liniami blach i okopceniem.
- **Światła**: pozycyjne z sektorami widoczności, stroboskopy, błyskacz, reflektory oświetlające teren i osady.
- **Kabina**: działające przyrządy (sztuczny horyzont, żyrobusola, wysokościomierz, wariometr, zegar, silnik),
  lampki, listwa LED, drążek i przepustnica; widok z kabiny z rozglądaniem się (C / V).
- **Księżyc i gwiazdy**: położenie i faza z efemerydy, Droga Mleczna, niebo obracające się z czasem gwiazdowym;
  nocą krajobraz oświetla księżyc.
- **Światła osad**: latarnie wzdłuż ulic z plamami światła i okna zapalane zależnie od godziny.
- Suwak daty (pory roku i fazy księżyca), godzina z całej doby.

## 0.5 – świat z OpenStreetMap

- Dane OSM dla regionu: drogi z oznakowaniem i duktami leśnymi, budynki z dachami i oknami, kościoły z wieżami.
- **Mapa cieni świata**: budynki i drzewa rzucają cienie.
- **Kolej i mosty**: tory z podkładami i szynami, stacje i perony, mosty drogowe i kolejowe.
- Detale: aleje przydrożne, linie energetyczne ze słupami i przewodami.
- **Rzeki** jako wstęgi wody (Brda, Kiczyna), las wycięty wzdłuż koryt.

## 0.4 – woda i las

- Jeziora: fale, odbicie nieba i drzew z brzegu, odblask słońca, głębia i piana przy brzegu.
- Las z pojedynczych drzew 3D (sosny, młodniki, liściaste), rozstawianych na GPU.

## 0.3 – samolot

- PZL M-18 Dromader z prostych brył, trójłopatowe śmigło z tarczą rozmycia.
- Arcade'owy model lotu: zakręt z przechyłu, przeciągnięcie, przyziemienie i kraksa.
- Kamera pościgowa, cień samolotu na ziemi.
- Wygładzanie TAA i efekt miniatury (tilt-shift).

## 0.2 – chmury

- Wolumetryczne chmury z rozpraszaniem wielokrotnym, cieniem na ziemi i zmienną pokrywą.

## 0.1 – teren i atmosfera

- Region Bory Tucholskie (46 × 46 km) z rzeczywistej rzeźby terenu i pokrycia ESA WorldCover.
- Fizyczna atmosfera (Hillaire): niebo, słońce, perspektywa powietrzna, zmienna pora dnia.
- Pola, łąki, lasy i zabudowa w materiale terenu, kamera swobodna.
