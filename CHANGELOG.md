# Dziennik zmian – Lot nad Polską

Historia odtworzona z przebiegu prac nad prototypem (repozytorium nie ma jeszcze commitów). Numery 0.1–0.6 nadane
wstecz kolejnym etapom; 0.7 to wersja pokazywana w grze. Kolejność wewnątrz wersji – od najważniejszych zmian.

## 0.7 – menu, samoloty do wyboru, wczytywanie

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
