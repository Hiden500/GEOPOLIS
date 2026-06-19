const fs = require('fs');

const data = JSON.parse(fs.readFileSync('Europe_mapping_1946.json', 'utf8'));

// Маппинги для новых стран (временные, без учёта смежности)
const newMappings = {
  ITA: {
    targetRegions: 18,
    mapping: {
      'Region_1': ['ITA-5442', 'ITA-5437', 'ITA-5451', 'ITA-5452', 'ITA-5444', 'ITA-5459'],
      'Region_2': ['ITA-5369', 'ITA-5441', 'ITA-5434', 'ITA-5366', 'ITA-5428', 'ITA-5467'],
      'Region_3': ['ITA-5455', 'ITA-5457', 'ITA-5458', 'ITA-5461', 'ITA-5463', 'ITA-5462'],
      'Region_4': ['ITA-5363', 'ITA-5364', 'ITA-5365', 'ITA-5427', 'ITA-5429', 'ITA-5430'],
      'Region_5': ['ITA-5431', 'ITA-5419', 'ITA-5418', 'ITA-5421', 'ITA-5401', 'ITA-5404'],
      'Region_6': ['ITA-5405', 'ITA-5403', 'ITA-5406', 'ITA-5407', 'ITA-5408', 'ITA-5389'],
      'Region_7': ['ITA-5391', 'ITA-5392', 'ITA-5393', 'ITA-5395', 'ITA-5394', 'ITA-5390'],
      'Region_8': ['ITA-5400', 'ITA-5397', 'ITA-5396', 'ITA-5426', 'ITA-5422', 'ITA-5423'],
      'Region_9': ['ITA-5379', 'ITA-5380', 'ITA-5381', 'ITA-5383', 'ITA-5382', 'ITA-5370'],
      'Region_10': ['ITA-5367', 'ITA-5368', 'ITA-5409', 'ITA-5411', 'ITA-5410', 'ITA-5417'],
      'Region_11': ['ITA-5416', 'ITA-5415', 'ITA-5414', 'ITA-5413', 'ITA-5371', 'ITA-5374'],
      'Region_12': ['ITA-5376', 'ITA-5375', 'ITA-5373', 'ITA-5372', 'ITA-5378', 'ITA-5377'],
      'Region_13': ['ITA-5412', 'ITA-5398', 'ITA-5440', 'ITA-5443', 'ITA-5445', 'ITA-5447'],
      'Region_14': ['ITA-5446', 'ITA-5450', 'ITA-5453', 'ITA-5454', 'ITA-5448', 'ITA-5388'],
      'Region_15': ['ITA-5387', 'ITA-5386', 'ITA-5436', 'ITA-5449', 'ITA-5424', 'ITA-5438'],
      'Region_16': ['ITA-5439', 'ITA-5460', 'ITA-5465', 'ITA-5464', 'ITA-5466', 'ITA-5361'],
      'Region_17': ['ITA-5360', 'ITA-5359', 'ITA-5358', 'ITA-5362', 'ITA-5384', 'ITA-5433'],
      'Region_18': ['ITA-5432', 'ITA-5425', 'ITA-5399', 'ITA-5420', 'ITA-5456', 'ITA-5402']
    }
  },
  NLD: {
    targetRegions: 10,
    mapping: {
      'Region_1': ['NLD-897', 'NLD-894', 'NLD-899', 'NLD-896', 'NLD-898'],
      'Region_2': ['NLD-903', 'NLD-3483', 'NLD-3485', 'NLD-3486', 'NLD-895'],
      'Region_3': ['NLD-5149', 'NLD-5148', 'NLD-5147', 'NLD-902', 'NLD-3484']
    }
  },
  GRC: {
    targetRegions: 18,
    mapping: {
      'Region_1': ['GRC-2892', 'GRC-2949', 'GRC-2991', 'GRC-3001', 'GRC-2992'],
      'Region_2': ['GRC-2900', 'GRC-2989', 'GRC-2884', 'GRC-2885', 'GRC-2886'],
      'Region_3': ['GRC-2990', 'GRC-3013', 'GRC-2988', 'GRC-2883']
    }
  },
  PRT: {
    targetRegions: 12,
    mapping: {
      'Region_1': ['PRT-744', 'PRT-747', 'PRT-741', 'PRT-751', 'PRT-753'],
      'Region_2': ['PRT-750', 'PRT-756', 'PRT-749', 'PRT-745', 'PRT-743'],
      'Region_3': ['PRT-746', 'PRT-742', 'PRT-748', 'PRT-752', 'PRT-754']
    }
  },
  AUT: {
    targetRegions: 6,
    mapping: {
      'Region_1': ['AUT-2331', 'AUT-2330', 'AUT-2326', 'AUT-2323', 'AUT-2329'],
      'Region_2': ['AUT-2325', 'AUT-2327', 'AUT-2322', 'AUT-2320']
    }
  },
  CHE: {
    targetRegions: 6,
    mapping: {
      'Region_1': ['CHE-165', 'CHE-170', 'CHE-171', 'CHE-174', 'CHE-176'],
      'Region_2': ['CHE-162', 'CHE-3425', 'CHE-3423', 'CHE-167', 'CHE-3426'],
      'Region_3': ['CHE-163', 'CHE-177', 'CHE-175', 'CHE-173', 'CHE-169']
    }
  },
  SRB: {
    targetRegions: 6,
    mapping: {
      'Region_1': ['SRB-274', 'SRB-273', 'SRB-275', 'SRB-841', 'SRB-125'],
      'Region_2': ['SRB-844', 'SRB-121', 'SRB-843', 'SRB-834', 'SRB-833'],
      'Region_3': ['SRB-835', 'SRB-1505', 'SRB-281', 'SRB-838', 'SRB-1059'],
      'Region_4': ['SRB-1061', 'SRB-1060', 'SRB-279', 'SRB-836', 'SRB-831'],
      'Region_5': ['SRB-830', 'SRB-832', 'SRB-839', 'SRB-829', 'SRB-83']
    }
  },
  HRV: {
    targetRegions: 5,
    mapping: {
      'Region_1': ['HRV-1609', 'HRV-1606', 'HRV-1608', 'HRV-1603', 'HRV-1592'],
      'Region_2': ['HRV-1490', 'HRV-1587', 'HRV-1602', 'HRV-1583', 'HRV-1493'],
      'Region_3': ['HRV-1605', 'HRV-1492', 'HRV-1610', 'HRV-1582', 'HRV-1588']
    }
  },
  BIH: {
    targetRegions: 5,
    mapping: {
      'Region_1': ['BIH-2228', 'BIH-4808', 'BIH-4807', 'BIH-4802', 'BIH-2225'],
      'Region_2': ['BIH-4801', 'BIH-3153', 'BIH-4803', 'BIH-4804', 'BIH-2224']
    }
  },
  BGR: {
    targetRegions: 6,
    mapping: {
      'Region_1': ['BGR-2254', 'BGR-2255', 'BGR-2232', 'BGR-2253', 'BGR-2245'],
      'Region_2': ['BGR-2244', 'BGR-2250', 'BGR-2252', 'BGR-3002', 'BGR-2261'],
      'Region_3': ['BGR-2262', 'BGR-2259', 'BGR-2251', 'BGR-2248', 'BGR-2249']
    }
  },
  MNE: {
    targetRegions: 3,
    mapping: {
      'Region_1': ['MNE-1506', 'MNE-1501', 'MNE-1509', 'MNE-1503', 'MNE-1516', 'MNE-1510', 'MNE-1520'],
      'Region_2': ['MNE-1515', 'MNE-1514', 'MNE-1507']
    }
  },
  SVN: {
    targetRegions: 6,
    mapping: {
      'Region_1': ['SVN-232', 'SVN-231', 'SVN-983', 'SVN-982', 'SVN-213', 'SVN-255'],
      'Region_2': ['SVN-938', 'SVN-958', 'SVN-987', 'SVN-212', 'SVN-969', 'SVN-945']
    }
  },
  XK: {
    targetRegions: 3,
    mapping: {
      'Region_1': ['XKX']
    }
  },
  MLT: {
    targetRegions: 1,
    mapping: {
      'Region_1': ['MLT-5950', 'MLT-5949', 'MLT-5936', 'MLT-5935', 'MLT-5934']
    }
  },
  ISL: {
    targetRegions: 2,
    mapping: {
      'Region_1': ['ISL-695', 'ISL-705', 'ISL-704', 'ISL-5131', 'ISL-709'],
      'Region_2': ['ISL-710', 'ISL-690', 'ISL-697', 'ISL-702']
    }
  },
  LIE: {
    targetRegions: 1,
    mapping: {
      'Region_1': ['LIE']
    }
  },
  AND: {
    targetRegions: 1,
    mapping: {
      'Region_1': ['AND-4878', 'AND-4879', 'AND-4880', 'AND-4877', 'AND-4882', 'AND-4881', 'AND-4876']
    }
  },
  MCO: {
    targetRegions: 1,
    mapping: {
      'Region_1': ['MCO']
    }
  },
  SMR: {
    targetRegions: 1,
    mapping: {
      'Region_1': ['SMR']
    }
  },
  VAT: {
    targetRegions: 1,
    mapping: {
      'Region_1': ['VAT']
    }
  },
  MDA: {
    targetRegions: 6,
    mapping: {
      'Region_1': ['MDA-1613', 'MDA-1615', 'MDA-1617', 'MDA-1621', 'MDA-1620', 'MDA-1623'],
      'Region_2': ['MDA-1642', 'MDA-1639', 'MDA-1641', 'MDA-1631', 'MDA-1632', 'MDA-1633']
    }
  },
  TUR: {
    targetRegions: 15,
    mapping: {
      'Region_1': ['TUR-4839', 'TUR-2298', 'TUR-3044', 'TUR-3047', 'TUR-4840', 'TUR-2307'],
      'Region_2': ['TUR-3048', 'TUR-2241', 'TUR-2240', 'TUR-3040', 'TUR-3041', 'TUR-3017'],
      'Region_3': ['TUR-4841', 'TUR-3016', 'TUR-2289', 'TUR-2265', 'TUR-2242', 'TUR-2239']
    }
  }
};

// Обновляем маппинги
Object.keys(newMappings).forEach(country => {
  if (data[country]) {
    data[country].mapping = newMappings[country].mapping;
  }
});

fs.writeFileSync('Europe_mapping_1946.json', JSON.stringify(data, null, 2));
console.log('Updated Europe mapping with new countries');
