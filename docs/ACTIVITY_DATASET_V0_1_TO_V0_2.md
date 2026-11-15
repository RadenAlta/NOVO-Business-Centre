# Perbandingan Dataset Aktivitas F4 v0 1 dan v0 2

| Aspek | v0.1 | v0.2 | Konsekuensi |
| --- | --- | --- | --- |
| Record | 120 | 144 | Kenaikan berasal dari 48 skenario, bukan suffix numerik. |
| Keluarga per label | 6 | 12 | Lebih banyak variasi semantik unit usaha dan tindakan. |
| Split per label | 4/1/1 family | 6/3/3 family | Final test lebih besar, tetapi masih sintetis dan kecil. |
| Formulasi/family | 5 variasi boilerplate | 3 parafrasa tertulis | Mengurangi shortcut “tahap peninjauan”. |
| Metadata review | Family saja | Family, semantic group, primary action, review status | Mendukung review leakage dan ambigu. |
| Taxonomy | `activity-category-v0.1` | Tetap `activity-category-v0.1` | Tidak mengubah arti label secara diam-diam. |
| Artefak model | v0.1 sudah diuji rendah | Tidak dilatih pada checkpoint ini | Tidak ada klaim peningkatan akurasi. |

Migrasi: pipeline dapat membaca label v0.1 lama, tetapi eksperimen v0.2 harus memakai generator/manifest v0.2 utuh. Jangan mencampur record v0.1 dan v0.2 tanpa sumber, review metadata, dan manifest baru. Model v0.1 tetap artefak historis lokal dan bukan pembanding produksi.
