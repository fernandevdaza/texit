import {
  BookMarked,
  File,
  FileArchive,
  FileCode2,
  FileCog,
  FileImage,
  FileJson2,
  FileSpreadsheet,
  FileText,
  FileType2,
  Folder,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react';
import { extname } from '@texit/core';
import { cn } from '@/lib/cn';

interface IconSpec {
  icon: LucideIcon;
  color: string;
  label: string;
}

const specs: Record<string, IconSpec> = {
  tex: { icon: FileText, color: '#16a34a', label: 'LaTeX' },
  bib: { icon: BookMarked, color: '#d97706', label: 'BibTeX' },
  style: { icon: FileCog, color: '#8b5cf6', label: 'LaTeX package' },
  image: { icon: FileImage, color: '#0ea5e9', label: 'Image' },
  pdf: { icon: FileType2, color: '#e5484d', label: 'PDF' },
  data: { icon: FileSpreadsheet, color: '#0d9488', label: 'Data' },
  json: { icon: FileJson2, color: '#ca8a04', label: 'JSON' },
  code: { icon: FileCode2, color: '#3b82f6', label: 'Code' },
  md: { icon: FileText, color: '#64748b', label: 'Markdown' },
  text: { icon: FileText, color: '#8a8a94', label: 'Text' },
  archive: { icon: FileArchive, color: '#a16207', label: 'Archive' },
  other: { icon: File, color: '#8a8a94', label: 'File' },
};

const extMap: Record<string, string> = {
  tex: 'tex', latex: 'tex', ltx: 'tex', dtx: 'tex', ins: 'tex', tikz: 'tex', pgf: 'tex', rnw: 'tex', rtex: 'tex',
  bib: 'bib', bst: 'style', bbx: 'style', cbx: 'style', lbx: 'style', dbx: 'style', bbl: 'bib',
  sty: 'style', cls: 'style', clo: 'style', cfg: 'style', def: 'style', fd: 'style', latexmkrc: 'style',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', avif: 'image', eps: 'image', tif: 'image', tiff: 'image',
  pdf: 'pdf',
  csv: 'data', tsv: 'data', dat: 'data', xlsx: 'data', xls: 'data',
  json: 'json', yaml: 'json', yml: 'json', toml: 'json', xml: 'json',
  py: 'code', js: 'code', ts: 'code', lua: 'code', sh: 'code', r: 'code', m: 'code', jl: 'code', c: 'code', cpp: 'code', h: 'code', java: 'code', rs: 'code', go: 'code', sage: 'code', gp: 'code', gnuplot: 'code', asy: 'code', mp: 'code', sql: 'code', css: 'code', html: 'code',
  md: 'md', markdown: 'md', rst: 'md', org: 'md',
  txt: 'text', log: 'text', aux: 'text', idx: 'text', ind: 'text', ist: 'text', gls: 'text', glo: 'text',
  zip: 'archive', gz: 'archive', tar: 'archive', tgz: 'archive', '7z': 'archive',
};

export function fileTypeOf(path: string): string {
  return extMap[extname(path)] ?? 'other';
}

export function fileTypeLabel(path: string): string {
  const ext = extname(path);
  if (ext === 'sty') return 'LaTeX package';
  if (ext === 'cls') return 'LaTeX class';
  return specs[fileTypeOf(path)]?.label ?? 'File';
}

export function FileIcon({ path, className, folder, open }: { path: string; className?: string; folder?: boolean; open?: boolean }) {
  if (folder) {
    const C = open ? FolderOpen : Folder;
    return <C className={cn('size-4 shrink-0 text-accent/75', className)} strokeWidth={1.9} aria-hidden />;
  }
  const spec = specs[fileTypeOf(path)] ?? specs.other;
  const C = spec.icon;
  return <C className={cn('size-4 shrink-0', className)} style={{ color: spec.color }} strokeWidth={1.9} aria-hidden />;
}
