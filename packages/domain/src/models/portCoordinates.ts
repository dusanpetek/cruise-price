import type { ItineraryStop } from './Itinerary';

type Coordinate = { lat: number; lng: number };

/**
 * Port coordinates in decimal degrees, keyed by UN/LOCODE. Sources:
 * - UN/LOCODE code list (datasets/un-locode, degrees and minutes): ESLPA, ESSPC, ESACE, PTFNC
 * - Wikidata records carrying the UN/LOCODE (P1937) and coordinates (P625): ESFUE (Q540185), MAAGA (Q170525)
 *
 * The ports of AIDA's search results (read live, 2026-11-27) follow: first the ones the UN/LOCODE list has coordinates for
 * (code list of datasets/un-locode, degrees and minutes, in the comment), then the ones only Wikidata has coordinates for
 * (the item is in the comment; where several items carry the same code and agree within 0.1 degrees, the lowest one is taken).
 * Not listed on purpose: ports without coordinates in either source, and codes whose only coordinates are an airport or
 * another place than the one AIDA names (AIDA's own sea-day and passage pseudo codes are not ports).
 */
const PORT_COORDINATES: Record<string, Coordinate> = {
  ESLPA: { lat: 28.1, lng: -15.4167 }, // Las Palmas de Gran Canaria, 28°06'N 15°25'W
  ESSPC: { lat: 28.6833, lng: -17.7667 }, // Santa Cruz de La Palma, 28°41'N 17°46'W
  MAAGA: { lat: 30.4214, lng: -9.5831 }, // Agadir
  ESFUE: { lat: 28.5, lng: -13.8667 }, // Puerto del Rosario
  ESACE: { lat: 28.9667, lng: -13.5333 }, // Arrecife (Lanzarote), 28°58'N 13°32'W
  PTFNC: { lat: 32.6333, lng: -16.9 }, // Funchal (Madeira), 32°38'N 16°54'W
  // UN/LOCODE
  AGSJO: { lat: 17.1167, lng: -61.85 }, // Saint John's, 17°07'N 61°51'W
  ARBUE: { lat: -34.5833, lng: -58.6667 }, // Buenos Aires, 34°35'S 58°40'W
  ARPMY: { lat: -42.75, lng: -65.0333 }, // Puerto Madryn, 42°45'S 65°02'W
  ARUSH: { lat: -54.8, lng: -68.3 }, // Ushuaia, 54°48'S 68°18'W
  AUADL: { lat: -34.9167, lng: 138.5833 }, // Adelaide, 34°55'S 138°35'E
  AUBNE: { lat: -27.4667, lng: 153.0167 }, // Brisbane, 27°28'S 153°01'E
  AUDRW: { lat: -12.45, lng: 130.8333 }, // Darwin, 12°27'S 130°50'E
  AUMEL: { lat: -37.8167, lng: 144.9667 }, // Melbourne, 37°49'S 144°58'E
  AUSYD: { lat: -33.85, lng: 151.2 }, // Sydney, 33°51'S 151°12'E
  BEZEE: { lat: 51.3333, lng: 3.2 }, // Zeebrugge, 51°20'N 3°12'E
  BQKRA: { lat: 12.15, lng: -68.2667 }, // Kralendijk, 12°09'N 68°16'W
  BRADR: { lat: -23, lng: -44.3167 }, // Angra dos Reis, 23°00'S 44°19'W
  BRBAC: { lat: -26.9833, lng: -48.6333 }, // Balneário Camboriú, 26°59'S 48°38'W
  BRFOR: { lat: -3.7167, lng: -38.5833 }, // Fortaleza, 03°43'S 38°35'W
  BRIBE: { lat: -23.7833, lng: -45.35 }, // Ilhabela, 23°47'S 45°21'W
  BRIOS: { lat: -14.7833, lng: -39.0333 }, // Ilhéus, 14°47'S 39°02'W
  BRREC: { lat: -8.05, lng: -34.8833 }, // Recife, 08°03'S 34°53'W
  BRRIO: { lat: -22.8667, lng: -43.2167 }, // Rio de Janeiro, 22°52'S 43°13'W
  BRSSA: { lat: -13, lng: -38.4833 }, // Salvador, 13°00'S 38°29'W
  BRSSZ: { lat: -23.9333, lng: -46.3167 }, // Santos, 23°56'S 46°19'W
  BRSTM: { lat: -2.4333, lng: -54.7167 }, // Santarém, 02°26'S 54°43'W
  CASJB: { lat: 45.2667, lng: -66.0667 }, // Saint-John, 45°16'N 66°04'W
  CASJF: { lat: 47.5667, lng: -52.7333 }, // Saint-John's, 47°34'N 52°44'W
  CLIPC: { lat: -27.15, lng: -109.4167 }, // Isla de Pascua, 27°09'S 109°25'W
  CLPMC: { lat: -41.4667, lng: -72.95 }, // Puerto Montt, 41°28'S 72°57'W
  CLSAI: { lat: -33.6, lng: -71.6 }, // San Antonio, 33°36'S 71°36'W
  CRLIO: { lat: 10, lng: -83.0333 }, // Puerto Limón, 10°00'N 83°02'W
  CRPAS: { lat: 9.9667, lng: -84.8333 }, // Puntarenas, 09°58'N 84°50'W
  CVMIN: { lat: 16.8833, lng: -25 }, // Mindelo, 16°53'N 25°00'W
  CWWIL: { lat: 12.1, lng: -68.9167 }, // Willemstad, 12°06'N 68°55'W
  CYLMS: { lat: 34.6833, lng: 33.05 }, // Limassol, 34°41'N 33°03'E
  DEHAM: { lat: 53.5167, lng: 9.9333 }, // Hamburg, 53°31'N 9°56'E
  DEKEL: { lat: 54.3333, lng: 10.1333 }, // Kiel, 54°20'N 10°08'E
  DEWAR: { lat: 54.1667, lng: 12.0833 }, // Warnemünde, 54°10'N 12°05'E
  DKAAR: { lat: 56.15, lng: 10.2167 }, // Aarhus, 56°09'N 10°13'E
  DKCPH: { lat: 55.6667, lng: 12.5833 }, // København, 55°40'N 12°35'E
  DOSAM: { lat: 19.2, lng: -69.3167 }, // Santa Bárbara de Samaná, 19°12'N 69°19'W
  DOSDQ: { lat: 18.4667, lng: -69.9 }, // Santo Domingo, 18°28'N 69°54'W
  EETLL: { lat: 59.4333, lng: 24.7333 }, // Tallinn, 59°26'N 24°44'E
  EGALY: { lat: 31.1833, lng: 29.9167 }, // El Iskandariya (Alexandria), 31°11'N 29°55'E
  ESAGP: { lat: 36.7167, lng: -4.4167 }, // Málaga, 36°43'N 4°25'W
  ESBIO: { lat: 43.25, lng: -2.9667 }, // Bilbao, 43°15'N 2°58'W
  ESCAR: { lat: 37.6, lng: -0.9833 }, // Cartagena, 37°36'N 0°59'W
  ESGIJ: { lat: 43.5333, lng: -5.6667 }, // Gijón, 43°32'N 5°40'W
  ESIBZ: { lat: 38.9, lng: 1.4333 }, // Ibiza, 38°54'N 1°26'E
  ESLCG: { lat: 43.3667, lng: -8.3833 }, // La Coruña (A Coruña), 43°22'N 8°23'W
  ESMAH: { lat: 39.8833, lng: 4.25 }, // Mahón, Menorca, 39°53'N 4°15'E
  ESPAL: { lat: 41.85, lng: 3.1333 }, // Palamós, 41°51'N 3°08'E
  ESPMI: { lat: 39.5667, lng: 2.6333 }, // Palma de Mallorca, 39°34'N 2°38'E
  FIHEL: { lat: 60.1667, lng: 24.9333 }, // Helsinki, 60°10'N 24°56'E
  FIHMN: { lat: 60.5667, lng: 27.2 }, // Hamina (Fredrikshamn), 60°34'N 27°12'E
  FIKEM: { lat: 65.7333, lng: 24.5667 }, // Kemi/Tornio (Kemi/Torneå), 65°44'N 24°34'E
  FIOUL: { lat: 65.0167, lng: 25.4667 }, // Uleåborg (Oulu), 65°01'N 25°28'E
  FJLTK: { lat: -17.6167, lng: 177.45 }, // Lautoka, 17°37'S 177°27'E
  FJSUV: { lat: -18.1333, lng: 178.45 }, // Suva, 18°08'S 178°27'E
  FRAJA: { lat: 41.9333, lng: 8.7333 }, // Ajaccio, 41°56'N 8°44'E
  FRBOD: { lat: 44.8333, lng: -0.5833 }, // Bordeaux, 44°50'N 0°35'W
  FRCEQ: { lat: 43.55, lng: 7.0167 }, // Cannes, 43°33'N 7°01'E
  FRCER: { lat: 49.6333, lng: -1.6167 }, // Cherbourg-en-Cotentin, 49°38'N 1°37'W
  FRLEH: { lat: 49.5, lng: 0.1 }, // Le Havre, 49°30'N 0°06'E
  FRMRS: { lat: 43.3, lng: 5.4 }, // Marseille, 43°18'N 5°24'E
  FRYNE: { lat: 43.1, lng: 5.8833 }, // La Seyne-sur-Mer, 43°06'N 5°53'E
  GBABD: { lat: 57.1333, lng: -2.1 }, // Aberdeen, 57°08'N 2°06'W
  GBBEL: { lat: 54.9833, lng: -5.9167 }, // Belfast, 54°59'N 5°55'W
  GBFIS: { lat: 51.9833, lng: -4.9667 }, // Fishguard, 51°59'N 4°58'W
  GBGRK: { lat: 55.9333, lng: -4.75 }, // Greenock, 55°56'N 4°45'W
  GBIVG: { lat: 57.7, lng: -4.1667 }, // Invergordon, 57°42'N 4°10'W
  GBKWL: { lat: 58.9833, lng: -2.95 }, // Kirkwall, 58°59'N 2°57'W
  GBLER: { lat: 60.15, lng: -1.15 }, // Lerwick, 60°09'N 1°09'W
  GBLIV: { lat: 53.4167, lng: -3 }, // Liverpool, 53°25'N 3°00'W
  GBNCL: { lat: 54.9667, lng: -1.6 }, // Newcastle upon Tyne, 54°58'N 1°36'W
  GBNWF: { lat: 55.9833, lng: -3.1833 }, // Newhaven/Edinburgh, 55°59'N 3°11'W
  GBOBA: { lat: 56.4167, lng: -5.4667 }, // Oban, 56°25'N 5°28'W
  GBPPO: { lat: 49.45, lng: -2.5333 }, // Saint Peter Port, 49°27'N 2°32'W
  GBPRT: { lat: 57.4167, lng: -6.1833 }, // Portree, 57°25'N 6°11'W
  GBSCR: { lat: 58.6167, lng: -3.55 }, // Scrabster, 58°37'N 3°33'W
  GBSTO: { lat: 58.2167, lng: -6.3667 }, // Stornoway, 58°13'N 6°22'W
  GLGOH: { lat: 64.1833, lng: -51.75 }, // Nuuk (Godthaab), 64°11'N 51°45'W
  GRARM: { lat: 38.1833, lng: 20.4833 }, // Argostólion, 38°11'N 20°29'E
  GRCFU: { lat: 39.6167, lng: 19.9167 }, // Kérkira (Corfu), 39°37'N 19°55'E
  GRGAF: { lat: 35.4833, lng: 24.1333 }, // Souda Bay, 35°29'N 24°08'E
  GRHER: { lat: 35.3333, lng: 25.1667 }, // Iraklion (Heraklion), 35°20'N 25°10'E
  GRJMK: { lat: 37.45, lng: 25.3333 }, // Mykonos, 37°27'N 25°20'E
  GRKAK: { lat: 37.65, lng: 21.3167 }, // Katakolon, 37°39'N 21°19'E
  GRKGS: { lat: 36.8667, lng: 27.25 }, // Kos, 36°52'N 27°15'E
  GRKVA: { lat: 40.9333, lng: 24.4 }, // Kavála, 40°56'N 24°24'E
  GRPIR: { lat: 37.9333, lng: 23.6167 }, // Piraeus, 37°56'N 23°37'E
  GRVOL: { lat: 39.3667, lng: 22.95 }, // Vólos, 39°22'N 22°57'E
  GRZTH: { lat: 37.7833, lng: 20.9 }, // Zákynthos, 37°47'N 20°54'E
  HKHKG: { lat: 22.3167, lng: 114.1667 }, // Hong Kong, 22°19'N 114°10'E
  HNRTM: { lat: 16.3333, lng: -86.5 }, // Mahogany Bay, 16°20'N 86°30'W
  HRDBV: { lat: 42.65, lng: 18.0833 }, // Dubrovnik, 42°39'N 18°05'E
  HRKOR: { lat: 42.95, lng: 17.1167 }, // Korcula, 42°57'N 17°07'E
  HRRJK: { lat: 45.3333, lng: 14.4 }, // Rijeka, 45°20'N 14°24'E
  HRZAD: { lat: 44.1167, lng: 15.2333 }, // Zadar, 44°07'N 15°14'E
  IDBOA: { lat: -8.7667, lng: 115.2167 }, // Benoa, 08°46'S 115°13'E
  IDLOM: { lat: -8.5, lng: 116.6667 }, // Lombok, 08°30'S 116°40'E
  IDSRG: { lat: -6.9667, lng: 110.4833 }, // Semarang, 06°58'S 110°29'E
  IDSUB: { lat: -7.2333, lng: 112.75 }, // Surabaya, 07°14'S 112°45'E
  IDTPP: { lat: -6.1, lng: 106.8833 }, // Tanjung Priok, 06°06'S 106°53'E
  IEDLG: { lat: 53.3, lng: -6.1333 }, // Dun Laoghaire, 53°18'N 6°08'W
  ISREY: { lat: 64.15, lng: -21.95 }, // Reykjavík, 64°09'N 21°57'W
  ITBRI: { lat: 41.1333, lng: 16.85 }, // Bari, 41°08'N 16°51'E
  ITCAG: { lat: 39.2167, lng: 9.1167 }, // Cagliari, 39°13'N 9°07'E
  ITCTA: { lat: 37.5, lng: 15.1 }, // Catania, 37°30'N 15°06'E
  ITCVV: { lat: 42.1, lng: 11.8 }, // Civitavecchia, 42°06'N 11°48'E
  ITLIV: { lat: 43.55, lng: 10.3167 }, // Livorno, 43°33'N 10°19'E
  ITMSN: { lat: 38.2, lng: 15.55 }, // Messina, 38°12'N 15°33'E
  ITNAP: { lat: 40.8333, lng: 14.25 }, // Napoli, 40°50'N 14°15'E
  ITOLB: { lat: 40.9167, lng: 9.5167 }, // Olbia, 40°55'N 9°31'E
  ITPMO: { lat: 38.1167, lng: 13.3667 }, // Palermo, 38°07'N 13°22'E
  ITSIR: { lat: 37.0667, lng: 15.2833 }, // Siracusa, 37°04'N 15°17'E
  ITSPE: { lat: 44.1167, lng: 9.8333 }, // La Spezia, 44°07'N 9°50'E
  ITTAR: { lat: 40.4833, lng: 17.2333 }, // Taranto, 40°29'N 17°14'E
  JPISG: { lat: 24.3333, lng: 124.15 }, // Ishigaki, 24°20'N 124°09'E
  JPOSA: { lat: 34.6667, lng: 135.5 }, // Osaka, 34°40'N 135°30'E
  JPTYO: { lat: 35.6833, lng: 139.75 }, // Tokyo, 35°41'N 139°45'E
  JPUKB: { lat: 34.6833, lng: 135.1667 }, // Kobe, 34°41'N 135°10'E
  JPYOK: { lat: 35.45, lng: 139.65 }, // Yokohama, 35°27'N 139°39'E
  KRCHA: { lat: 33.5, lng: 126.5167 }, // Jeju, 33°30'N 126°31'E
  KRINC: { lat: 37.45, lng: 126.6167 }, // Incheon, 37°27'N 126°37'E
  KRPUS: { lat: 35.1333, lng: 129.05 }, // Busan, 35°08'N 129°03'E
  KYGCM: { lat: 19.2833, lng: -81.35 }, // Grand Cayman, 19°17'N 81°21'W
  LCCAS: { lat: 14.0167, lng: -60.9667 }, // Castries, 14°01'N 60°58'W
  LKCMB: { lat: 6.9167, lng: 79.85 }, // Colombo, 06°55'N 79°51'E
  LKHBA: { lat: 6.1167, lng: 81.1167 }, // Hambantota, 06°07'N 81°07'E
  MACAS: { lat: 33.5833, lng: -7.6 }, // Casablanca, 33°35'N 7°36'W
  MATNG: { lat: 35.7833, lng: -5.8167 }, // Tangier, 35°47'N 5°49'W
  MEKOT: { lat: 42.4167, lng: 18.7667 }, // Kotor, 42°25'N 18°46'E
  MGNOS: { lat: -13.3333, lng: 48.25 }, // Nosy-Be, 13°20'S 48°15'E
  MQFDF: { lat: 14.6, lng: -61.05 }, // Fort-de-France, 14°36'N 61°03'W
  MTMLA: { lat: 35.8833, lng: 14.5 }, // Valletta, 35°53'N 14°30'E
  MVMLE: { lat: 4.1667, lng: 73.5 }, // Male, 04°10'N 73°30'E
  MXCZM: { lat: 20.5167, lng: -86.9333 }, // Cozumel, 20°31'N 86°56'W
  MXPVR: { lat: 20.6, lng: -105.2167 }, // Puerto Vallarta, 20°36'N 105°13'W
  MYLGK: { lat: 6.3667, lng: 99.8 }, // Langkawi, 06°22'N 99°48'E
  MYPEN: { lat: 5.4167, lng: 100.3167 }, // Penang (Georgetown), 05°25'N 100°19'E
  MYPKG: { lat: 3, lng: 101.4 }, // Port Klang (Pelabuhan Klang), 03°00'N 101°24'E
  NALUD: { lat: -26.65, lng: 15.1667 }, // Lüderitz, 26°39'S 15°10'E
  NCLIF: { lat: -20.9667, lng: 167.2333 }, // Lifou, 20°58'S 167°14'E
  NCNOU: { lat: -22.2667, lng: 166.45 }, // Nouméa, 22°16'S 166°27'E
  NLIJM: { lat: 52.4667, lng: 4.6 }, // IJmuiden/Velsen, 52°28'N 4°36'E
  NLRTM: { lat: 51.9167, lng: 4.5 }, // Rotterdam, 51°55'N 4°30'E
  NOAES: { lat: 62.4667, lng: 6.15 }, // Ålesund, 62°28'N 6°09'E
  NOALF: { lat: 69.9667, lng: 23.2333 }, // Alta, 69°58'N 23°14'E
  NOAND: { lat: 62.5667, lng: 7.7 }, // Åndalsnes, 62°34'N 7°42'E
  NOBGO: { lat: 60.3833, lng: 5.3167 }, // Bergen, 60°23'N 5°19'E
  NOBNN: { lat: 65.4667, lng: 12.2 }, // Brønnøysund, 65°28'N 12°12'E
  NOBOO: { lat: 67.2833, lng: 14.3667 }, // Bodø, 67°17'N 14°22'E
  NOEDF: { lat: 60.4667, lng: 7.0667 }, // Eidfjord, 60°28'N 7°04'E
  NOFLA: { lat: 60.8667, lng: 7.1167 }, // Flåm, 60°52'N 7°07'E
  NOHAU: { lat: 59.4, lng: 5.25 }, // Haugesund, 59°24'N 5°15'E
  NOHFT: { lat: 70.65, lng: 23.6667 }, // Hammerfest, 70°39'N 23°40'E
  NOHRD: { lat: 68.7833, lng: 16.5333 }, // Harstad, 68°47'N 16°32'E
  NOHVG: { lat: 70.9667, lng: 25.9667 }, // Honningsvåg, 70°58'N 25°58'E
  NOKRS: { lat: 58.1333, lng: 7.9833 }, // Kristiansand, 58°08'N 7°59'E
  NOLKN: { lat: 68.15, lng: 13.6 }, // Leknes, 68°09'N 13°36'E
  NOMAY: { lat: 61.9333, lng: 5.1 }, // Måløy, 61°56'N 5°06'E
  NOMOL: { lat: 62.7333, lng: 7.15 }, // Molde, 62°44'N 7°09'E
  NONFD: { lat: 61.9, lng: 5.9833 }, // Nordfjordeid, 61°54'N 5°59'E
  NOOLD: { lat: 61.8333, lng: 6.8 }, // Olden, 61°50'N 6°48'E
  NOOSL: { lat: 59.9, lng: 10.7333 }, // Oslo, 59°54'N 10°44'E
  NOSLN: { lat: 61.4833, lng: 7.5833 }, // Skjolden, 61°29'N 7°35'E
  NOSLX: { lat: 68.7, lng: 15.4167 }, // Sortland, 68°42'N 15°25'E
  NOSVG: { lat: 58.9667, lng: 5.75 }, // Stavanger, 58°58'N 5°45'E
  NOTOS: { lat: 69.6667, lng: 18.9667 }, // Tromsø, 69°40'N 18°58'E
  NOTRD: { lat: 63.4333, lng: 10.4 }, // Trondheim, 63°26'N 10°24'E
  NOVIS: { lat: 61.0833, lng: 6.5833 }, // Vik - Sogn, 61°05'N 6°35'E
  NZAKL: { lat: -36.8333, lng: 174.8 }, // Auckland, 36°50'S 174°48'E
  NZLYT: { lat: -43.6, lng: 172.7167 }, // Lyttelton, 43°36'S 172°43'E
  NZNPE: { lat: -39.4667, lng: 176.9 }, // Napier, 39°28'S 176°54'E
  NZPCN: { lat: -41.2833, lng: 174 }, // Picton, 41°17'S 174°00'E
  NZTRG: { lat: -37.6833, lng: 176.1667 }, // Tauranga, 37°41'S 176°10'E
  NZWLG: { lat: -41.2667, lng: 174.7833 }, // Wellington, 41°16'S 174°47'E
  PAONX: { lat: 9.35, lng: -79.8667 }, // Colón, 09°21'N 79°52'W
  PAPCN: { lat: 9.0667, lng: -79.6667 }, // Panama Canal, 09°04'N 79°40'W
  PAPTY: { lat: 8.9667, lng: -79.5333 }, // Panamá, Ciudad de, 08°58'N 79°32'W
  PFMOZ: { lat: -17.5, lng: -149.7667 }, // Mo'orea, 17°30'S 149°46'W
  PFPPT: { lat: -17.5333, lng: -149.5667 }, // Papeete, 17°32'S 149°34'W
  PHBOR: { lat: 11.9667, lng: 121.9167 }, // Boracay, 11°58'N 121°55'E
  PLGDY: { lat: 54.5, lng: 18.55 }, // Gdynia, 54°30'N 18°33'E
  PTLEI: { lat: 41.1833, lng: -8.6833 }, // Leixões, 41°11'N 8°41'W
  PTLIS: { lat: 38.7167, lng: -9.1333 }, // Lisboa, 38°43'N 9°08'W
  PTPDL: { lat: 37.7333, lng: -25.6667 }, // Ponta Delgada, 37°44'N 25°40'W
  PTPRV: { lat: 38.7333, lng: -27.0667 }, // Praia da Vitória, 38°44'N 27°04'W
  RELPT: { lat: -20.9333, lng: 55.3167 }, // Le Port, 20°56'S 55°19'E
  SEGOT: { lat: 57.7167, lng: 11.9667 }, // Göteborg, 57°43'N 11°58'E
  SEKAA: { lat: 56.1667, lng: 15.5833 }, // Karlskrona, 56°10'N 15°35'E
  SELYS: { lat: 58.2833, lng: 11.4333 }, // Lysekil, 58°17'N 11°26'E
  SESTO: { lat: 59.3333, lng: 18.05 }, // Stockholm, 59°20'N 18°03'E
  SEVBY: { lat: 57.6333, lng: 18.3 }, // Visby, 57°38'N 18°18'E
  SEYST: { lat: 55.4167, lng: 13.8167 }, // Ystad, 55°25'N 13°49'E
  SGSIN: { lat: 1.2833, lng: 103.85 }, // Singapore, 01°17'N 103°51'E
  SJLYR: { lat: 78.2167, lng: 15.6333 }, // Longyearbyen, 78°13'N 15°38'E
  SXPHI: { lat: 18.0167, lng: -63.0333 }, // Philipsburg, 18°01'N 63°02'W
  THLCH: { lat: 13.0833, lng: 100.8833 }, // Laem Chabang, 13°05'N 100°53'E
  TOTBU: { lat: -21.1333, lng: -175.2 }, // Nuku'alofa, 21°08'S 175°12'W
  TRALA: { lat: 36.5333, lng: 31.9833 }, // Alanya, 36°32'N 31°59'E
  TRAYT: { lat: 36.8333, lng: 30.6 }, // Antalya, 36°50'N 30°36'E
  TRBXN: { lat: 37.0333, lng: 27.4167 }, // Bodrum, 37°02'N 27°25'E
  TRIST: { lat: 41.0167, lng: 28.9667 }, // Istanbul, 41°01'N 28°58'E
  TRMRM: { lat: 36.85, lng: 28.2667 }, // Marmaris, 36°51'N 28°16'E
  USBAL: { lat: 39.2833, lng: -76.6167 }, // Baltimore, 39°17'N 76°37'W
  USHNL: { lat: 21.3, lng: -157.85 }, // Honolulu, 21°18'N 157°51'W
  USKHH: { lat: 19.65, lng: -156 }, // Kailua Kona, 19°39'N 156°00'W
  USLAX: { lat: 34.05, lng: -118.25 }, // Los Angeles, 34°03'N 118°15'W
  USNYC: { lat: 40.7, lng: -74 }, // New York, 40°42'N 74°00'W
  USOGG: { lat: 20.8833, lng: -156.4667 }, // Kahului, 20°53'N 156°28'W
  USPCV: { lat: 28.4, lng: -80.6 }, // Port Canaveral, 28°24'N 80°36'W
  USSAN: { lat: 32.7, lng: -117.15 }, // San Diego, 32°42'N 117°09'W
  VCKTN: { lat: 13.1333, lng: -61.2167 }, // Kingstown, 13°08'N 61°13'W
  VNDAD: { lat: 16.0667, lng: 108.2167 }, // Da Nang, 16°04'N 108°13'E
  ZACPT: { lat: -33.9167, lng: 18.4167 }, // Cape Town, 33°55'S 18°25'E
  ZADUR: { lat: -29.85, lng: 31.0167 }, // Durban, 29°51'S 31°01'E
  ZAPLZ: { lat: -33.95, lng: 25.6 }, // Gqeberha, 33°57'S 25°36'E
  // Wikidata (P1937 + P625)
  AUBME: { lat: -17.963, lng: 122.2301 }, // Broome (Q113271355)
  AUBWT: { lat: -41.0523, lng: 145.905 }, // Burnie (Q30345898)
  AUCNS: { lat: -16.9256, lng: 145.7753 }, // Cairns (Q189133)
  AUFRE: { lat: -32.0534, lng: 115.7586 }, // Fremantle (Q5501469)
  AUGET: { lat: -28.777, lng: 114.615 }, // Geraldton (Q29162121)
  AUTSV: { lat: -19.2622, lng: 146.8158 }, // Townsville (Q190021)
  AWORJ: { lat: 12.5167, lng: -70.05 }, // Port of Oranjestad (Q21972949)
  BBBGI: { lat: 13.0975, lng: -59.6167 }, // Bridgetown (Q36168)
  BSFPO: { lat: 26.52, lng: -78.66 }, // Freeport (Q867573)
  BZBZE: { lat: 17.4986, lng: -88.1886 }, // Belize City (Q108223)
  CAHAL: { lat: 44.65, lng: -63.6 }, // Halifax (Q3246744)
  CKARU: { lat: -18.8667, lng: -159.8 }, // Arutanga (Q2717494)
  COCTG: { lat: 10.4236, lng: -75.5253 }, // Cartagena (Q657461)
  COSMR: { lat: 11.2361, lng: -74.2017 }, // Santa Marta (Q209016)
  CVRAI: { lat: 14.9105, lng: -23.5053 }, // Porto da Praia (Q23007049)
  DKFRC: { lat: 55.5644, lng: 9.7597 }, // Fredericia (Q21181)
  DKNBG: { lat: 55.3097, lng: 10.7917 }, // Nyborg (Q3530435)
  DKRNN: { lat: 55.1, lng: 14.7 }, // Rønne (Q690062)
  DKSKA: { lat: 57.7222, lng: 10.5878 }, // Skagen (Q215177)
  DMRSU: { lat: 15.3, lng: -61.3833 }, // Roseau (Q36281)
  DOCBJ: { lat: 17.9253, lng: -71.6583 }, // Port of Cabo Rojo (Q7231101)
  EGPSD: { lat: 31.2625, lng: 32.3061 }, // Port Said (Q134509)
  ESALC: { lat: 38.3453, lng: -0.4831 }, // Alicante (Q11959)
  ESBCN: { lat: 41.3825, lng: 2.1769 }, // Barcelona (Q1492)
  ESSCT: { lat: 28.4667, lng: -16.25 }, // Santa Cruz de Tenerife (Q14328)
  ESSDR: { lat: 43.4667, lng: -3.8 }, // Santander (Q12233)
  ESTAR: { lat: 41.1175, lng: 1.2528 }, // Tarragona (Q15088)
  ESVGO: { lat: 42.237, lng: -8.733 }, // Port of Vigo (Q947819)
  ESVLC: { lat: 39.4457, lng: -0.3199 }, // Port of Valencia (Q2069059)
  GBDVR: { lat: 51.1192, lng: 1.3294 }, // Port of Dover (Q739207)
  GBFAL: { lat: 50.15, lng: -5.0667 }, // Falmouth (Q478029)
  GBHLY: { lat: 53.3167, lng: -4.6333 }, // Holyhead (Q257446)
  GBPME: { lat: 50.8058, lng: -1.0872 }, // Portsmouth (Q72259)
  GBPTL: { lat: 50.585, lng: -2.445 }, // Portland Harbour (Q1585169)
  GBSOU: { lat: 50.8965, lng: -1.3968 }, // Port of Southampton (Q7231265)
  GIGIB: { lat: 36.14, lng: -5.35 }, // Gibraltar (Q1410)
  GLJHS: { lat: 66.9389, lng: -53.6722 }, // Sisimiut (Q208098)
  GLJNN: { lat: 60.1417, lng: -45.2431 }, // Nanortalik (Q855324)
  ISISA: { lat: 66.0738, lng: -23.1417 }, // Ísafjörður (Q106896)
  ITSAL: { lat: 40.6806, lng: 14.7594 }, // Salerno (Q1083)
  ITTRS: { lat: 45.6503, lng: 13.7703 }, // Trieste (Q546)
  JMMBJ: { lat: 18.4667, lng: -77.9167 }, // Montego Bay (Q637555)
  JPAOJ: { lat: 40.8228, lng: 140.7469 }, // Aomori (Q146790)
  JPAXT: { lat: 39.7199, lng: 140.1026 }, // Akita (Q17139)
  JPBPU: { lat: 33.2858, lng: 131.4528 }, // Beppu (Q273880)
  JPHIJ: { lat: 34.3852, lng: 132.4553 }, // Hiroshima (Q34664)
  JPHIM: { lat: 34.8152, lng: 134.6854 }, // Himeji (Q209801)
  JPHKD: { lat: 41.7687, lng: 140.7289 }, // Hakodate (Q26418)
  JPKCZ: { lat: 33.5588, lng: 133.5312 }, // Kōchi (Q200251)
  JPKIJ: { lat: 37.9162, lng: 139.0364 }, // Niigata (Q179691)
  JPKNZ: { lat: 36.5611, lng: 136.6565 }, // Kanazawa (Q191130)
  JPKOJ: { lat: 31.5968, lng: 130.5571 }, // Kagoshima (Q15674)
  JPMAI: { lat: 35.4748, lng: 135.386 }, // Maizuru (Q750573)
  JPNAH: { lat: 26.2122, lng: 127.6792 }, // Naha (Q181966)
  JPSMN: { lat: 35.5396, lng: 133.2316 }, // Sakaiminato (Q496431)
  LTKLJ: { lat: 55.661, lng: 21.1455 }, // Port of Klaipėda (Q1567799)
  LVRIX: { lat: 56.9475, lng: 24.1069 }, // Riga (Q1773)
  MGDIE: { lat: -12.3224, lng: 49.295 }, // Antsiranana (Q218928)
  MUPLU: { lat: -20.1619, lng: 57.4989 }, // Port Louis (Q3929)
  MZMPM: { lat: -25.9689, lng: 32.5733 }, // Maputo (Q3889)
  NAWVB: { lat: -22.9494, lng: 14.5069 }, // Walvis Bay (Q220843)
  NOGNR: { lat: 62.0997, lng: 7.205 }, // Geiranger (Q1019493)
  PHPPS: { lat: 9.74, lng: 118.744 }, // Puerto Princesa (Q111739)
  SCPRI: { lat: -4.3206, lng: 55.7322 }, // Praslin (Q581819)
  SIKOP: { lat: 45.5475, lng: 13.7307 }, // Koper (Q1015)
  TCGDT: { lat: 21.4722, lng: -71.1389 }, // Grand Turk (Q1473924)
  TWKEL: { lat: 25.1283, lng: 121.7419 }, // Keelung (Q249996)
  TWKHH: { lat: 22.615, lng: 120.2975 }, // Kaohsiung (Q181557)
  USBOS: { lat: 42.3603, lng: -71.0578 }, // Boston (Q100)
  USEYW: { lat: 24.5597, lng: -81.7836 }, // Key West (Q485186)
  USITO: { lat: 19.7056, lng: -155.0858 }, // Hilo (Q216258)
  USMIA: { lat: 25.7742, lng: -80.1936 }, // Miami (Q8652)
  USMSY: { lat: 29.9761, lng: -90.0783 }, // New Orleans (Q34404)
  USNPT: { lat: 41.4917, lng: -71.3119 }, // Newport (Q54264)
  USORF: { lat: 36.8469, lng: -76.2853 }, // Norfolk (Q49231)
  USPWM: { lat: 43.66, lng: -70.255 }, // Portland (Q49201)
  USSBA: { lat: 34.4258, lng: -119.7142 }, // Santa Barbara (Q159288)
  USSFO: { lat: 37.775, lng: -122.4194 }, // San Francisco (Q62)
  USTPA: { lat: 27.9475, lng: -82.4586 }, // Q49255 (Q49255)
  UYMVD: { lat: -34.9059, lng: -56.1913 }, // Montevideo (Q1335)
  UYPDP: { lat: -34.9557, lng: -54.9381 }, // Punta del Este (Q56069)
  VGTOV: { lat: 18.4167, lng: -64.5833 }, // Tortola (Q827604)
  VNPHU: { lat: 10.5833, lng: 107.0333 }, // Phu My (Q111387289)
  ZAELS: { lat: -33.0175, lng: 27.9047 }, // East London (Q209537)
  // Seychelles (added 2026-11-27: AIDAblu "Mauritius, Seychellen & Madagaskar" showed no Seychelles). Neither code has coordinates in the
  // UN/LOCODE list and no Wikidata item carries it, so the place AIDA names is taken from Wikidata:
  SCPOV: { lat: -4.6236, lng: 55.4544 }, // "Mahe" = Port Victoria, i.e. Victoria on Mahé (Q3940; UN/LOCODE SC VIC, 04°37'S 055°27'E, agrees)
  SCLDI: { lat: -4.3667, lng: 55.8333 }, // La Digue, island centre (Q581154); the berth La Passe is a few km off
};

/**
 * Normalized port name to UN/LOCODE, for providers that give names only (Mein Schiff).
 * Plain "Santa Cruz" is deliberately not aliased: it is ambiguous (La Palma ESSPC vs Tenerife ESSCT)
 * and a wrong marker is worse than a missing one.
 */
const NAME_ALIASES: Record<string, string> = {
  'las palmas': 'ESLPA',
  'santa cruz de la palma': 'ESSPC',
  agadir: 'MAAGA',
  'puerto del rosario': 'ESFUE',
  arrecife: 'ESACE',
  funchal: 'PTFNC',
  // Mein Schiff prints the island in brackets; with it the name is unambiguous (matched before the bracket is dropped).
  'santa cruz (la palma)': 'ESSPC',
  'santa cruz (teneriffa)': 'ESSCT',
};

/** Lowercase, diacritics folded, whitespace collapsed. */
function foldName(name: string): string {
  return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Lowercase, diacritics folded, anything after "/" or "(" dropped. */
function normalizeName(name: string): string {
  return foldName(name).replace(/[/(].*$/, '').trim();
}

/** Coordinates of a stop: by UN/LOCODE first, then by normalized name. Null when the port is unknown. */
export function portCoordinate(stop: Pick<ItineraryStop, 'code' | 'name'>): Coordinate | null {
  const byCode = stop.code ? PORT_COORDINATES[stop.code] : undefined;
  if (byCode) return byCode;
  const alias = stop.name ? (NAME_ALIASES[foldName(stop.name)] ?? NAME_ALIASES[normalizeName(stop.name)]) : undefined;
  return (alias ? PORT_COORDINATES[alias] : undefined) ?? null;
}
