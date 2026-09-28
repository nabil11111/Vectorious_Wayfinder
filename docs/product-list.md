# Wayfinder product list

Store managers order from a fixed list per brand. Each item has a fixed weight and volume per unit, so an order's load is quantity times the item's numbers and nobody types kilos or cubic metres. The figures follow the order history (deliveries_train.csv, per unit): Fresh about 6.9 kg and 0.037 m³, Style about 15 kg and 0.24 m³, Tech about 210 kg and 0.7 m³.

| Brand | Item | Unit | kg | m³ | Temp | Notes |
|---|---|---|---|---|---|---|
| Fresh | Chilled carton | carton | 6.9 | 0.037 | chilled | needs a reefer |
| Fresh | Dry carton | carton | 6.9 | 0.037 | dry | |
| Style | Folded clothing | box | 12 | 0.20 | dry | |
| Style | Hanging garments | rail box | 14 | 0.30 | dry | keep upright |
| Style | Shoes | carton | 18 | 0.22 | dry | |
| Style | Bags and accessories | carton | 9 | 0.14 | dry | |
| Tech | Televisions | pallet of 8 | 170 | 0.60 | dry | |
| Tech | Washing machines | crate of 3 | 210 | 0.70 | dry | tail lift |
| Tech | Refrigerators | crate of 2 | 250 | 0.85 | dry | tail lift |
| Tech | Small appliances | pallet | 190 | 0.62 | dry | |

Fresh has no sub-categories on purpose: every Fresh carton is about the same size, and only cold or dry changes loading. Style and Tech are never chilled in the data.
