'use client';

import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui/Select';

interface ClassOption {
  id: string;
  name: string;
}

interface Props {
  classes: ClassOption[];
  value: string;
}

export function ClassFilter({ classes, value }: Props) {
  const router = useRouter();

  return (
    <div className="w-full max-w-xs">
      <Select
        id="classFilter"
        label="Filter by Class"
        options={classes.map((c) => ({ value: c.id, label: c.name }))}
        placeholder="All classes"
        value={value}
        onChange={(e) => {
          const classId = e.target.value;
          router.push(classId ? `/admin/students?classId=${classId}` : '/admin/students');
        }}
      />
    </div>
  );
}
