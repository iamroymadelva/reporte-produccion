export type AppRole = "ADMINISTRATOR" | "OPERATOR" | "VIEWER";
export type ReportStatus = "DRAFT" | "SUBMITTED" | "CANCELLED";

export interface Profile {
  id: string;
  full_name: string;
  role: AppRole;
  job_title: string | null;
  active: boolean;
}

export interface Option {
  id: string;
  code: string;
  name: string;
  active?: boolean;
}

export const roleLabels: Record<AppRole, string> = {
  ADMINISTRATOR: "Administrador",
  OPERATOR: "Operario",
  VIEWER: "Consulta",
};

export const statusLabels: Record<ReportStatus, string> = {
  DRAFT: "En curso",
  SUBMITTED: "Enviado",
  CANCELLED: "Cancelado",
};
