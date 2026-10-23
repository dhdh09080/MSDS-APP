"""Rebuild the legacy font's invalid cmap sentinel without changing glyph outlines."""
import argparse
from fontTools.ttLib import TTFont,newTable
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable
parser=argparse.ArgumentParser();parser.add_argument('source');parser.add_argument('--output',default='public/fonts/hy-headline-m.ttf');args=parser.parse_args()
f=TTFont(args.source);mapping=f.getBestCmap().copy();table=newTable('cmap');table.tableVersion=0;table.tables=[]
sub=CmapSubtable.newSubtable(4);sub.platformID=3;sub.platEncID=1;sub.language=0;sub.cmap={c:g for c,g in mapping.items() if c<65535};table.tables.append(sub);f['cmap']=table
if 'DSIG' in f:del f['DSIG']
f.save(args.output)
